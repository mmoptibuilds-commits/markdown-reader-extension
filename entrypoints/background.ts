import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { acceptOpenRequest, OPEN_IN_READER_MESSAGE, readerUrlFor } from '../src/core/auto-open';
import { handoffTextOf } from '../src/core/local-file';
import { SETTINGS_STORAGE_KEY } from '../src/core/settings';
import { parseSettingsChange, SETTINGS_CHANGE_MESSAGE, SettingsChangeError } from '../src/core/settings-change';
import { createAutoRenderSync, originToMatchPattern } from '../src/shared/auto-render-sync';
import { AUTO_RENDER_UPDATE_MESSAGE, OPEN_RESULT, type OpenResult } from '../src/shared/messages';
import { getAutoRenderOrigins, loadSettings, putLocalHandoff, removeLocalHandoffsForTab, writeSettingsLocally } from '../src/shared/storage';

const AUTO_RENDER_ID = 'markdown-reader-auto-render';
// The content script's built path, relative to the extension root.
const AUTO_RENDER_SCRIPT = 'content-scripts/auto-render.js';
const extensionOrigin = globalThis.location.origin;

const syncAutoRender = createAutoRenderSync({
  readOrigins: getAutoRenderOrigins,
  readLocalFilesEnabled: async () => (await loadSettings()).autoOpenLocalFiles,
  hasOriginAccess: (pattern) => browser.permissions.contains({ origins: [pattern] }),
  registry: {
    isRegistered: async () =>
      (await browser.scripting.getRegisteredContentScripts({ ids: [AUTO_RENDER_ID] })).length > 0,
    register: async (matches) => {
      await browser.scripting.registerContentScripts([{ id: AUTO_RENDER_ID, matches, js: [AUTO_RENDER_SCRIPT], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]);
    },
    update: async (matches) => {
      await browser.scripting.updateContentScripts([{ id: AUTO_RENDER_ID, matches, js: [AUTO_RENDER_SCRIPT], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }]);
    },
    unregister: async () => {
      await browser.scripting.unregisterContentScripts({ ids: [AUTO_RENDER_ID] });
    },
  },
  reportError: (error) => console.warn('Automatic Markdown opening could not be updated.', error),
});

const retrySync = (): void => {
  void syncAutoRender().catch(() => undefined);
};

const localOptInOf = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && (value as { autoOpenLocalFiles?: unknown }).autoOpenLocalFiles === true;

interface Sender {
  id?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
}

/** Extension pages (popup, reader, settings). A content script's sender URL is its page's. */
const isExtensionPage = (sender: Sender): boolean =>
  sender.id === browser.runtime.id && sender.url?.startsWith(`${extensionOrigin}/`) === true;

async function originAllowed(senderUrl: string | undefined): Promise<boolean> {
  let origin: string;
  try { origin = new URL(senderUrl ?? '').origin; } catch { return false; }
  const pattern = originToMatchPattern(origin);
  if (!pattern) return false;
  const [origins, granted] = await Promise.all([getAutoRenderOrigins(), browser.permissions.contains({ origins: [pattern] })]);
  return granted && origins.includes(origin);
}

/**
 * Moves the sender's own tab into the reader. Pages cannot navigate to the reader
 * themselves because it is not web-accessible. For a local file, the text the content
 * script read is kept in session storage; Firefox's reader depends on it.
 */
async function openInReader(message: unknown, sender: Sender): Promise<OpenResult> {
  const settings = await loadSettings();
  const accepted = acceptOpenRequest({
    message,
    senderUrl: sender.url,
    senderId: sender.id,
    extensionId: browser.runtime.id,
    frameId: sender.frameId,
    tabId: sender.tab?.id,
    localFilesEnabled: settings.autoOpenLocalFiles,
    originAllowed: sender.url?.startsWith('http') ? await originAllowed(sender.url) : false,
  });
  if (!accepted) return { opened: false, reason: 'refused' };
  let token: string | undefined;
  if (accepted.local) {
    const text = handoffTextOf(message);
    if (text !== undefined) {
      token = crypto.randomUUID();
      try { await putLocalHandoff(token, { url: accepted.url, text, tabId: accepted.tabId }); } catch { token = undefined; }
    }
    if (!token && import.meta.env.FIREFOX) return { opened: false, reason: 'handoff-failed' };
  }
  const readerPage = `${extensionOrigin}/reader.html`;
  await browser.tabs.update(accepted.tabId, { url: readerUrlFor(readerPage, accepted.url, token) });
  return { opened: true };
}

/** Every extension page's settings changes pass through this one queue, in arrival order. */
async function applySettingsChangeMessage(message: { change?: unknown }) {
  const change = parseSettingsChange(message.change);
  if (!change) return { ok: false, error: 'This settings change is not valid.', rejected: true };
  try {
    return { ok: true, settings: await writeSettingsLocally(change) };
  } catch (error) {
    return error instanceof SettingsChangeError
      ? { ok: false, error: error.message, rejected: true }
      : { ok: false, error: 'Settings could not be saved. Browser storage may be full or unavailable.' };
  }
}

function route(message: { type?: unknown; change?: unknown }, sender: Sender): Promise<unknown> | undefined {
  if (message.type === OPEN_IN_READER_MESSAGE) return openInReader(message, sender);
  if (!isExtensionPage(sender)) return undefined;
  if (message.type === AUTO_RENDER_UPDATE_MESSAGE) return syncAutoRender().then(() => ({ ok: true }));
  if (message.type === SETTINGS_CHANGE_MESSAGE) return applySettingsChangeMessage(message);
  return undefined;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(retrySync);
  browser.runtime.onStartup.addListener(retrySync);
  browser.permissions.onRemoved.addListener(retrySync);
  browser.permissions.onAdded.addListener(retrySync);
  // Chromium restarts the extension when its file URL access changes, and the worker can
  // stop at any time, so every start re-checks the registration.
  retrySync();
  browser.storage.onChanged.addListener((changes, area) => {
    const change = area === 'local' ? changes[SETTINGS_STORAGE_KEY] : undefined;
    if (change && localOptInOf(change.oldValue) !== localOptInOf(change.newValue)) retrySync();
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void removeLocalHandoffsForTab(tabId).catch(() => undefined);
  });
  // Replies go through sendResponse: Chromium before 148 ignores a Promise returned here.
  browser.runtime.onMessage.addListener((message: unknown, sender: Sender, sendResponse: (response: unknown) => void) => {
    if (typeof message !== 'object' || message === null) return false;
    const reply = route(message as { type?: unknown }, sender);
    if (!reply) return false;
    reply.then(sendResponse, () => sendResponse(OPEN_RESULT.failed));
    return true;
  });
});
