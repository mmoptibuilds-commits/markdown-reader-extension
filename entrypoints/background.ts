import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { acceptLocalHandoffRequest, LOCAL_HANDOFF_MESSAGE } from '../src/core/local-file';
import { SETTINGS_STORAGE_KEY } from '../src/core/settings';
import { getAutoRenderOrigins, loadSettings, putLocalHandoff, removeLocalHandoffsForTab } from '../src/shared/storage';
import { createAutoRenderSync } from '../src/shared/auto-render-sync';

const AUTO_RENDER_ID = 'markdown-reader-auto-render';
// The content script's built path, relative to the extension root.
const AUTO_RENDER_SCRIPT = 'content-scripts/auto-render.js';

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

/** Stores a local file's text for the reader and returns its token, or nothing if refused. */
async function storeLocalHandoff(message: unknown, sender: { url?: string | undefined; frameId?: number | undefined; tab?: { id?: number | undefined } | undefined }): Promise<{ token?: string }> {
  const enabled = (await loadSettings()).autoOpenLocalFiles;
  const accepted = acceptLocalHandoffRequest({ message, senderUrl: sender.url, frameId: sender.frameId, tabId: sender.tab?.id, enabled });
  if (!accepted) return {};
  const token = crypto.randomUUID();
  try {
    await putLocalHandoff(token, accepted);
    return { token };
  } catch {
    return {};
  }
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
  browser.runtime.onMessage.addListener((message, sender) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return undefined;
    if (message.type === 'markdown-reader:update-auto-render') return syncAutoRender();
    if (message.type === LOCAL_HANDOFF_MESSAGE) return storeLocalHandoff(message, sender);
    return undefined;
  });
});
