import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { plainTextOfDocument, readerUrlFor, shouldOpenInReader } from '../src/core/auto-open';
import { LOCAL_HANDOFF_LIMIT_BYTES, LOCAL_HANDOFF_MESSAGE } from '../src/core/local-file';
import { loadSettings } from '../src/shared/storage';

// WXT's typed browser.runtime omits getURL; the runtime provides it in Chromium and Firefox.
const readerPage = (): string => (browser.runtime as unknown as { getURL(path: string): string }).getURL('reader.html');

const documentParsed = (): Promise<void> => new Promise((resolve) => {
  if (document.readyState !== 'loading') resolve();
  else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
});

/**
 * Hands a local file's text to the background worker, which keeps it in session storage
 * for the reader. Firefox does not let extension pages read file URLs, so this copy is
 * how the reader gets the text there. Returns the handoff token, if one was issued.
 */
async function handOffLocalText(text: string): Promise<string | undefined> {
  if (new TextEncoder().encode(text).byteLength > LOCAL_HANDOFF_LIMIT_BYTES) return undefined;
  try {
    const reply: unknown = await browser.runtime.sendMessage({ type: LOCAL_HANDOFF_MESSAGE, url: location.href, text });
    const token = typeof reply === 'object' && reply !== null ? (reply as { token?: unknown }).token : undefined;
    return typeof token === 'string' ? token : undefined;
  } catch {
    return undefined;
  }
}

async function openLocalFile(): Promise<void> {
  // The registration can lag behind a settings change, so re-check the opt-in here.
  const settings = await loadSettings().catch(() => undefined);
  if (!settings?.autoOpenLocalFiles) return;
  const page = { url: location.href, contentType: document.contentType, topLevel: window.top === window, localFilesEnabled: true };
  if (!shouldOpenInReader(page)) return;
  await documentParsed();
  const text = plainTextOfDocument(document);
  if (text === undefined) return;
  const token = await handOffLocalText(text);
  location.replace(readerUrlFor(readerPage(), location.href, token));
}

/**
 * Registered at runtime by the background worker, only for origins the user has granted
 * and, when the user opts in, for local files. `matches` stays empty on purpose: WXT turns
 * runtime `matches` into install-time host permissions, which would request every site.
 */
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  runAt: 'document_start',
  allFrames: false,
  main() {
    if (location.protocol === 'file:') {
      void openLocalFile();
      return;
    }
    const shouldOpen = shouldOpenInReader({
      url: location.href,
      contentType: document.contentType,
      topLevel: window.top === window,
      localFilesEnabled: false,
    });
    if (shouldOpen) location.replace(readerUrlFor(readerPage(), location.href));
  },
});
