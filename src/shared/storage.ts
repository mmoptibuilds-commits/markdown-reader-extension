import { browser } from 'wxt/browser';
import {
  loadSettings as loadCoreSettings,
  saveSettings as saveCoreSettings,
  updateSettings,
  type ReaderSettings,
  type SettingsStorage,
} from '../core/settings';
import { parseLocalHandoff, type LocalHandoff } from '../core/local-file';

export interface RecentDocument {
  id: string;
  name: string;
  kind: 'local' | 'remote' | 'page';
  lastOpened: number;
  url?: string;
}

export interface Bookmark {
  id: string;
  documentName: string;
  headingId: string;
  headingText: string;
  createdAt: number;
}

export interface SessionDocument {
  kind: 'local' | 'page';
  name: string;
  source: string;
  text: string;
  lastModified?: number;
  size?: number;
}

export const SESSION_DOCUMENT_KEY = 'markdownReaderPendingDocument';
const RECENTS_KEY = 'markdownReaderRecents';
const PROGRESS_KEY = 'markdownReaderProgress';
const BOOKMARKS_KEY = 'markdownReaderBookmarks';
const AUTO_RENDER_KEY = 'markdownReaderAutoRenderOrigins';
const LOCAL_HANDOFF_PREFIX = 'markdownReaderLocalFile:';
const MAX_LOCAL_HANDOFFS = 6;
const handoffTokenPattern = /^[\w-]{8,64}$/u;

interface StoredLocalHandoff extends LocalHandoff {
  tabId: number;
  createdAt: number;
}

const settingsStorage: SettingsStorage = {
  get: (key) => browser.storage.local.get(key),
  set: (items) => browser.storage.local.set(items),
};

export const loadSettings = (): Promise<ReaderSettings> => loadCoreSettings(settingsStorage);
export const saveSettings = (settings: unknown): Promise<ReaderSettings> => saveCoreSettings(settingsStorage, settings);
/** Saves only the given fields, merged into whatever is stored at write time. */
export const patchSettings = (patch: Partial<ReaderSettings>): Promise<ReaderSettings> => updateSettings(settingsStorage, patch);

export async function getRecents(): Promise<RecentDocument[]> {
  const value: unknown = (await browser.storage.local.get(RECENTS_KEY))[RECENTS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RecentDocument =>
    typeof item === 'object' && item !== null &&
    typeof (item as RecentDocument).id === 'string' &&
    typeof (item as RecentDocument).name === 'string' &&
    ['local', 'remote', 'page'].includes((item as RecentDocument).kind) &&
    typeof (item as RecentDocument).lastOpened === 'number',
  ).slice(0, 12);
}

export async function addRecent(document: Omit<RecentDocument, 'lastOpened'>): Promise<void> {
  const recents = await getRecents();
  const safe: RecentDocument = {
    id: document.id.slice(0, 512),
    name: document.name.slice(0, 200),
    kind: document.kind,
    lastOpened: Date.now(),
    ...(document.kind === 'remote' && document.url ? { url: document.url.slice(0, 4096) } : {}),
  };
  await browser.storage.local.set({ [RECENTS_KEY]: [safe, ...recents.filter((item) => item.id !== safe.id)].slice(0, 12) });
}

export async function clearRecents(): Promise<void> {
  await browser.storage.local.remove(RECENTS_KEY);
}

export async function takePendingDocument(): Promise<SessionDocument | undefined> {
  const result = await browser.storage.session.get(SESSION_DOCUMENT_KEY);
  await browser.storage.session.remove(SESSION_DOCUMENT_KEY);
  const value: unknown = result[SESSION_DOCUMENT_KEY];
  if (typeof value !== 'object' || value === null) return undefined;
  const item = value as Partial<SessionDocument>;
  if ((item.kind !== 'local' && item.kind !== 'page') || typeof item.name !== 'string' || typeof item.text !== 'string') {
    return undefined;
  }
  return {
    kind: item.kind,
    name: item.name.slice(0, 200),
    source: typeof item.source === 'string' ? item.source.slice(0, 2048) : item.name,
    text: item.text,
    ...(typeof item.lastModified === 'number' ? { lastModified: item.lastModified } : {}),
    ...(typeof item.size === 'number' ? { size: item.size } : {}),
  };
}

export async function putPendingDocument(document: SessionDocument): Promise<void> {
  await browser.storage.session.set({ [SESSION_DOCUMENT_KEY]: document });
}

export async function getReadingPosition(id: string): Promise<number | undefined> {
  const values = await browser.storage.local.get(PROGRESS_KEY);
  const positions: unknown = values[PROGRESS_KEY];
  if (typeof positions !== 'object' || positions === null) return undefined;
  const value = (positions as Record<string, unknown>)[id];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

export async function saveReadingPosition(id: string, progress: number): Promise<void> {
  const values = await browser.storage.local.get(PROGRESS_KEY);
  const prior: unknown = values[PROGRESS_KEY];
  const positions = typeof prior === 'object' && prior !== null ? { ...prior as Record<string, unknown> } : {};
  positions[id] = Math.min(1, Math.max(0, progress));
  const keys = Object.keys(positions);
  for (const stale of keys.slice(0, Math.max(0, keys.length - 100))) delete positions[stale];
  await browser.storage.local.set({ [PROGRESS_KEY]: positions });
}

export async function getBookmarks(): Promise<Bookmark[]> {
  const value: unknown = (await browser.storage.local.get(BOOKMARKS_KEY))[BOOKMARKS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Bookmark =>
    typeof item === 'object' && item !== null &&
    typeof (item as Bookmark).id === 'string' &&
    typeof (item as Bookmark).headingId === 'string' &&
    typeof (item as Bookmark).documentName === 'string',
  ).slice(0, 200);
}

export async function toggleBookmark(bookmark: Bookmark): Promise<boolean> {
  const bookmarks = await getBookmarks();
  const exists = bookmarks.some((item) => item.id === bookmark.id && item.headingId === bookmark.headingId);
  const next = exists
    ? bookmarks.filter((item) => item.id !== bookmark.id || item.headingId !== bookmark.headingId)
    : [{ ...bookmark, documentName: bookmark.documentName.slice(0, 200), headingText: bookmark.headingText.slice(0, 300) }, ...bookmarks].slice(0, 200);
  await browser.storage.local.set({ [BOOKMARKS_KEY]: next });
  return !exists;
}

export async function getAutoRenderOrigins(): Promise<string[]> {
  const value: unknown = (await browser.storage.local.get(AUTO_RENDER_KEY))[AUTO_RENDER_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && /^https?:\/\//iu.test(item)).slice(0, 100);
}

export async function setAutoRenderOrigins(origins: string[]): Promise<void> {
  await browser.storage.local.set({ [AUTO_RENDER_KEY]: [...new Set(origins)].slice(0, 100) });
}

export async function clearLocalReaderData(): Promise<void> {
  await browser.storage.local.remove([RECENTS_KEY, PROGRESS_KEY, BOOKMARKS_KEY, AUTO_RENDER_KEY]);
}

const storedHandoffs = async (): Promise<Array<[string, StoredLocalHandoff]>> => {
  const all = await browser.storage.session.get(null);
  return Object.entries(all)
    .filter((entry): entry is [string, StoredLocalHandoff] => entry[0].startsWith(LOCAL_HANDOFF_PREFIX) && typeof entry[1] === 'object' && entry[1] !== null)
    .sort(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
};

/**
 * Keeps a local file's text in memory-only session storage so the reader can show it in
 * browsers that do not let extension pages read file URLs. Entries are bounded in number,
 * evicted oldest first when the quota is reached, and removed when their tab closes.
 */
export async function putLocalHandoff(token: string, handoff: LocalHandoff & { tabId: number }): Promise<void> {
  if (!handoffTokenPattern.test(token)) throw new Error('Invalid handoff token.');
  const entry: StoredLocalHandoff = { url: handoff.url, text: handoff.text, tabId: handoff.tabId, createdAt: Date.now() };
  const older = (await storedHandoffs()).map(([key]) => key);
  const excess = older.slice(MAX_LOCAL_HANDOFFS - 1);
  if (excess.length) await browser.storage.session.remove(excess);
  const evictable = older.slice(0, MAX_LOCAL_HANDOFFS - 1);
  for (;;) {
    try {
      await browser.storage.session.set({ [LOCAL_HANDOFF_PREFIX + token]: entry });
      return;
    } catch (error) {
      const oldest = evictable.pop();
      if (!oldest) throw error;
      await browser.storage.session.remove(oldest);
    }
  }
}

/** Returns the stored text only when the token and the file URL both match. */
export async function getLocalHandoff(token: string, url: string): Promise<LocalHandoff | undefined> {
  if (!handoffTokenPattern.test(token)) return undefined;
  const key = LOCAL_HANDOFF_PREFIX + token;
  return parseLocalHandoff((await browser.storage.session.get(key))[key], url);
}

export async function removeLocalHandoffsForTab(tabId: number): Promise<void> {
  const keys = (await storedHandoffs()).filter(([, entry]) => entry.tabId === tabId).map(([key]) => key);
  if (keys.length) await browser.storage.session.remove(keys);
}
