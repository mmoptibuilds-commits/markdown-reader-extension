import { browser } from 'wxt/browser';
import {
  loadSettings as loadCoreSettings,
  saveSettings as saveCoreSettings,
  updateSettings,
  type ReaderSettings,
  type SettingsStorage,
} from '../core/settings';

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
