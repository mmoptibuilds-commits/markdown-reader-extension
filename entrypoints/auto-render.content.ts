import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { readerUrlFor, shouldOpenInReader } from '../src/core/auto-open';

/**
 * Registered at runtime by the background worker, only for origins the user has granted.
 * `matches` stays empty on purpose: WXT turns runtime `matches` into install-time host
 * permissions, which would request every site. The real origin list is set at runtime.
 */
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  allFrames: false,
  main() {
    const shouldOpen = shouldOpenInReader({
      url: location.href,
      contentType: document.contentType,
      topLevel: window.top === window,
      fileAccessAllowed: false,
    });
    if (!shouldOpen) return;
    // WXT's typed browser.runtime omits getURL; the runtime provides it in Chromium and Firefox.
    const { getURL } = browser.runtime as unknown as { getURL(path: string): string };
    location.replace(readerUrlFor(getURL('reader.html'), location.href));
  },
});
