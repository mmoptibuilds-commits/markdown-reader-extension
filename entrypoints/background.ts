import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { getAutoRenderOrigins } from '../src/shared/storage';

const AUTO_RENDER_ID = 'markdown-reader-auto-render';
let syncPromise: Promise<void> | undefined;

function syncAutoRender(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const registered = await browser.scripting.getRegisteredContentScripts({ ids: [AUTO_RENDER_ID] });
    if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [AUTO_RENDER_ID] });

    const origins = await getAutoRenderOrigins();
    const permitted: string[] = [];
    for (const origin of origins) {
      try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) continue;
        if (await browser.permissions.contains({ origins: [`${origin}/*`] })) permitted.push(`${origin}/*`);
      } catch { /* Ignore a damaged or stale stored origin. */ }
    }
    if (!permitted.length) return;
    await browser.scripting.registerContentScripts([{
      id: AUTO_RENDER_ID,
      matches: permitted,
      js: ['auto-render.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    }]);
  })().finally(() => { syncPromise = undefined; });
  return syncPromise;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => { void syncAutoRender(); });
  browser.runtime.onStartup.addListener(() => { void syncAutoRender(); });
  browser.permissions.onRemoved.addListener(() => { void syncAutoRender(); });
  browser.runtime.onMessage.addListener((message) => {
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'markdown-reader:update-auto-render') {
      return syncAutoRender();
    }
    return undefined;
  });
});
