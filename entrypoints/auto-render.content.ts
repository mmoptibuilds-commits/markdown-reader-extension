import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { OPEN_IN_READER_MESSAGE, plainTextOfDocument, planLocalOpen, shouldOpenInReader, type NavigationKind } from '../src/core/auto-open';
import type { OpenResult } from '../src/shared/messages';
import { loadSettings } from '../src/shared/storage';

const documentParsed = (): Promise<void> => new Promise((resolve) => {
  if (document.readyState !== 'loading') resolve();
  else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
});

const navigationKind = (): NavigationKind => {
  const type: string | undefined = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
  return type === 'back_forward' || type === 'reload' || type === 'prerender' ? type : 'navigate';
};

/** Asks the background worker to move this tab into the reader. */
async function requestReader(text?: string): Promise<OpenResult> {
  try {
    const reply = await browser.runtime.sendMessage({ type: OPEN_IN_READER_MESSAGE, url: location.href, ...(text === undefined ? {} : { text }) }) as OpenResult | undefined;
    return reply && typeof reply === 'object' && 'opened' in reply ? reply : { opened: false, reason: 'failed' };
  } catch {
    return { opened: false, reason: 'failed' };
  }
}

/**
 * A small notice above the browser's plain-text view. It uses a closed shadow root and
 * plain text, loads nothing, and appears only on documents automatic opening applies to.
 */
function showNotice(message: string, action?: { label: string; run: () => Promise<OpenResult> }): void {
  document.getElementById('markdown-reader-notice')?.remove();
  const host = document.createElement('div');
  host.id = 'markdown-reader-notice';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial;display:block;position:sticky;top:0;z-index:2147483647}
    div{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 14px;border-bottom:1px solid #b9c2b9;background:#f3f5f1;color:#1f2a22;font:14px/1.4 system-ui,sans-serif}
    @media (prefers-color-scheme:dark){div{background:#232823;color:#e7ebe5;border-color:#4b554c}}
    button{font:inherit;padding:4px 10px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
    button:focus-visible{outline:3px solid #4f8a68;outline-offset:2px}`;
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  box.append(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      button.disabled = true;
      void action.run().then((result) => {
        if (!result.opened) { button.disabled = false; text.textContent = result.reason === 'handoff-failed' ? handoffFailedText : 'Markdown Reader could not open this document. Check the extension settings, then try again.'; }
      });
    });
    box.append(button);
  }
  root.append(style, box);
  document.body?.prepend(host);
}

const handoffFailedText = 'Markdown Reader could not take this file over automatically. Open the reader and choose it with Open file.';

async function openLocalFile(navigationType: NavigationKind): Promise<void> {
  // The registration can lag behind a settings change, so re-check the opt-in here.
  const settings = await loadSettings().catch(() => undefined);
  if (!settings?.autoOpenLocalFiles) return;
  if (!shouldOpenInReader({ url: location.href, contentType: document.contentType, topLevel: window.top === window, localFilesEnabled: true })) return;
  await documentParsed();
  const text = plainTextOfDocument(document);
  if (text === undefined) return;
  const bytes = new TextEncoder().encode(text).byteLength;
  const openNow = () => {
    const plan = planLocalOpen({ bytes, firefox: import.meta.env.FIREFOX, navigationType: 'navigate' });
    return requestReader(plan.action === 'open' && plan.sendText ? text : undefined);
  };
  const plan = planLocalOpen({ bytes, firefox: import.meta.env.FIREFOX, navigationType });
  if (plan.action === 'stay') {
    if (plan.reason === 'history') showNotice('This Markdown file can be shown in Markdown Reader.', { label: 'Open in reader', run: openNow });
    else if (plan.reason === 'too-large') showNotice('This file is larger than the 16 MB reading limit, so Markdown Reader left it as plain text.');
    else showNotice('This file is larger than 4 MB, so Firefox cannot pass it to Markdown Reader automatically. Open the reader and choose it with Open file.');
    return;
  }
  const result = await requestReader(plan.sendText ? text : undefined);
  if (!result.opened && result.reason === 'handoff-failed') showNotice(handoffFailedText, { label: 'Try again', run: openNow });
}

async function openWebDocument(navigationType: NavigationKind): Promise<void> {
  if (!shouldOpenInReader({ url: location.href, contentType: document.contentType, topLevel: window.top === window, localFilesEnabled: false })) return;
  if (navigationType === 'back_forward') {
    await documentParsed();
    showNotice('This Markdown document can be shown in Markdown Reader.', { label: 'Open in reader', run: () => requestReader() });
    return;
  }
  await requestReader();
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
    const start = (navigationType: NavigationKind): void => {
      void (location.protocol === 'file:' ? openLocalFile(navigationType) : openWebDocument(navigationType));
    };
    start(navigationKind());
    // A page restored from the back/forward cache does not rerun this script.
    window.addEventListener('pageshow', (event) => { if (event.persisted) start('back_forward'); });
  },
});
