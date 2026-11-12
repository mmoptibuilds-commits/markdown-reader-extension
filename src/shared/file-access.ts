import { browser } from 'wxt/browser';
import { LOCAL_FILE_MATCH_PATTERN } from './auto-render-sync';

/**
 * Asks the browser whether this extension may read local files. Chromium answers from the
 * extension's "Allow access to file URLs" setting; Firefox 153 and later answer from its
 * "Access local files on your computer" permission. The `file:///*` host permission must
 * also be held. Returns undefined when the browser cannot answer.
 */
export async function getLocalFileAccess(): Promise<boolean | undefined> {
  try {
    if (typeof browser.extension?.isAllowedFileSchemeAccess !== 'function') return undefined;
    if (!(await browser.extension.isAllowedFileSchemeAccess())) return false;
    return await browser.permissions.contains({ origins: [LOCAL_FILE_MATCH_PATTERN] });
  } catch {
    return undefined;
  }
}

/**
 * The extension's own details page, where Chromium browsers show the file URL switch.
 * Firefox does not let extensions open about:addons, so it has no link.
 */
export function extensionSettingsUrl(): string | undefined {
  if (import.meta.env.FIREFOX) return undefined;
  return `chrome://extensions/?id=${encodeURIComponent(browser.runtime.id)}`;
}
