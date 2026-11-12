import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { getAutoRenderOrigins } from '../src/shared/storage';
import { createAutoRenderSync } from '../src/shared/auto-render-sync';

const AUTO_RENDER_ID = 'markdown-reader-auto-render';
// The content script's built path, relative to the extension root.
const AUTO_RENDER_SCRIPT = 'content-scripts/auto-render.js';

const syncAutoRender = createAutoRenderSync({
  readOrigins: getAutoRenderOrigins,
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

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(retrySync);
  browser.runtime.onStartup.addListener(retrySync);
  browser.permissions.onRemoved.addListener(retrySync);
  browser.runtime.onMessage.addListener((message) => {
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'markdown-reader:update-auto-render') {
      return syncAutoRender();
    }
    return undefined;
  });
});
