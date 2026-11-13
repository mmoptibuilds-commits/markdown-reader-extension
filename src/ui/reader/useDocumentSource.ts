import { browser } from 'wxt/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isOpenableFileName } from '../../core/document';
import { checkLocalFileSize, localAutoOpenState, localFileNameFromUrl, LocalFileError, parseLocalMarkdownUrl, readLocalMarkdown, type LocalAutoOpenState } from '../../core/local-file';
import { documentNameFromUrl, readRemoteMarkdown, RemoteDocumentError } from '../../core/remote';
import { getLocalFileAccess } from '../../shared/file-access';
import { addRecent, getLocalHandoff, loadSettings, takePendingDocument } from '../../shared/storage';
import type { FolderWorkspace, ReaderDocument, ReaderProblem } from './types';

const MAX_FOLDER_FILES = 2500;
const imagePathPattern = /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;
/** Folders that hold tooling, not documents. Skipping them keeps large repositories readable. */
const skippedFolders = new Set(['.git', 'node_modules', '.hg', '.svn', '.venv', '__pycache__']);

export function stableIdentifier(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(36);
}

const fileDocumentId = (identity: string, size: number, lastModified: number): string =>
  `local:${size.toString(36)}:${lastModified.toString(36)}:${stableIdentifier(identity)}`;

const localAccessMessages: Record<Exclude<LocalAutoOpenState, 'active'>, string> = {
  disabled: 'Automatic opening of local files is off. Turn it on in Settings › Files & online documents, or use Open file.',
  'permission-required': 'The browser has not given Markdown Reader access to local files. Settings › Files & online documents explains how to allow it.',
  unavailable: 'This browser does not let Markdown Reader read local files automatically. Use Open file instead.',
};

interface DirectoryHandleLike {
  name: string;
  kind: 'directory';
  entries(): AsyncIterable<[string, FileSystemHandleLike]>;
}
interface FileHandleLike { kind: 'file'; getFile(): Promise<File> }
type FileSystemHandleLike = DirectoryHandleLike | FileHandleLike;

export interface DocumentSource {
  document: ReaderDocument | undefined;
  folder: FolderWorkspace | undefined;
  loading: boolean;
  problem: ReaderProblem | undefined;
  setProblem: (problem: ReaderProblem | undefined) => void;
  openFile: (file: File) => Promise<void>;
  openFolderFiles: (files: File[], folderName: string, pathsIncludeRoot: boolean) => Promise<void>;
  openDirectoryPicker: (fallback: () => void) => Promise<void>;
  openFolderPath: (path: string) => Promise<boolean>;
  openRemote: (rawUrl: string) => Promise<boolean>;
  /** Re-fetches the open remote document; returns true when its text changed. */
  refreshRemote: (quiet: boolean) => Promise<boolean>;
}

/**
 * Owns which document is open. Every open request gets a sequence number and an abort
 * signal, so a slow load can never replace a document the user opened after it.
 */
export function useDocumentSource(): DocumentSource {
  const [document, setDocument] = useState<ReaderDocument>();
  const [folder, setFolder] = useState<FolderWorkspace>();
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<ReaderProblem>();
  const sequence = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const objectUrls = useRef<string[]>([]);
  const documentRef = useRef<ReaderDocument | undefined>(undefined);
  documentRef.current = document;

  const begin = useCallback(() => {
    controller.current?.abort();
    controller.current = new AbortController();
    sequence.current += 1;
    const id = sequence.current;
    return { signal: controller.current.signal, current: () => id === sequence.current };
  }, []);

  const show = useCallback((next: ReaderDocument) => {
    setDocument(next);
    setProblem(undefined);
    void addRecent({ id: next.id, name: next.name, kind: next.kind, ...(next.kind === 'remote' ? { url: next.source } : {}) }).catch(() => undefined);
  }, []);

  const revokeAssets = useCallback(() => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  }, []);

  useEffect(() => () => { controller.current?.abort(); revokeAssets(); }, [revokeAssets]);

  const readLocal = useCallback(async (file: File, path: string, workspace: FolderWorkspace | undefined): Promise<void> => {
    const tooLarge = checkLocalFileSize(file.size);
    if (tooLarge) { setProblem({ message: tooLarge.message }); return; }
    const run = begin();
    setLoading(true);
    try {
      const text = await file.text();
      if (!run.current()) return;
      const name = path.split('/').at(-1) ?? file.name;
      show({
        id: fileDocumentId(workspace ? `${workspace.name}/${path}` : file.name, file.size, file.lastModified),
        name,
        source: workspace ? `${workspace.name}/${path}` : file.name,
        text,
        kind: 'local',
        documentPath: path,
        lastModified: file.lastModified,
        size: file.size,
      });
    } catch {
      if (run.current()) setProblem({ message: 'This file could not be read. Check that it still exists, then choose it again.' });
    } finally {
      if (run.current()) setLoading(false);
    }
  }, [begin, show]);

  const openFile = useCallback(async (file: File) => {
    if (!isOpenableFileName(file.name) && file.type !== 'text/markdown' && file.type !== 'text/plain') {
      setProblem({ message: 'Choose a Markdown file (.md and similar) or a plain text file.' });
      return;
    }
    revokeAssets();
    setFolder(undefined);
    await readLocal(file, file.name, undefined);
  }, [readLocal, revokeAssets]);

  const openFolderFiles = useCallback(async (files: File[], folderName: string, pathsIncludeRoot: boolean) => {
    if (files.length > MAX_FOLDER_FILES) {
      setProblem({ message: `This folder has more than ${MAX_FOLDER_FILES.toLocaleString()} files. Choose a smaller folder to keep the reader responsive.` });
      return;
    }
    const entries = new Map<string, File>();
    for (const file of files) {
      const raw = file.webkitRelativePath || file.name;
      // The directory input includes the chosen folder's name; the directory picker does not.
      const path = pathsIncludeRoot ? raw.replace(/^[^/]*\//u, '') : raw;
      if (path.split('/').some((part) => skippedFolders.has(part))) continue;
      entries.set(path, file);
    }
    const markdownPaths = [...entries.keys()].filter(isOpenableFileName).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const first = markdownPaths.find((path) => /(?:^|\/)readme\.(?:md|markdown)$/iu.test(path) && !path.includes('/')) ??
      markdownPaths.find((path) => /(?:^|\/)readme\.(?:md|markdown)$/iu.test(path)) ?? markdownPaths[0];
    if (!first) {
      setProblem({ message: 'This folder has no Markdown files. Choose a folder that contains .md documents.' });
      return;
    }
    revokeAssets();
    const assets = new Map<string, string>();
    for (const [path, file] of entries) {
      if (!imagePathPattern.test(path)) continue;
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      assets.set(path, url);
    }
    const workspace: FolderWorkspace = { name: folderName, files: entries, assets };
    const file = entries.get(first);
    setFolder(workspace);
    if (file) await readLocal(file, first, workspace);
  }, [readLocal, revokeAssets]);

  const openDirectoryPicker = useCallback(async (fallback: () => void) => {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) { fallback(); return; }
    let root: DirectoryHandleLike;
    try { root = await picker(); } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setProblem({ message: 'The folder could not be opened. Check that the browser can access it, then try again.' });
      return;
    }
    const files: File[] = [];
    let truncated = false;
    const walk = async (handle: DirectoryHandleLike, prefix: string): Promise<void> => {
      for await (const [name, entry] of handle.entries()) {
        if (files.length >= MAX_FOLDER_FILES) { truncated = true; return; }
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          Object.defineProperty(file, 'webkitRelativePath', { value: path });
          files.push(file);
        } else if (!skippedFolders.has(name)) {
          await walk(entry, path);
        }
      }
    };
    try {
      await walk(root, '');
      await openFolderFiles(files, root.name, false);
      if (truncated) setProblem({ message: `Only the first ${MAX_FOLDER_FILES.toLocaleString()} files were loaded. Choose a smaller folder to see every file.` });
    } catch {
      setProblem({ message: 'The folder could not be read. Check that the browser can access it, then try again.' });
    }
  }, [openFolderFiles]);

  const folderRef = useRef(folder);
  folderRef.current = folder;
  const openFolderPath = useCallback(async (path: string): Promise<boolean> => {
    const workspace = folderRef.current;
    const file = workspace?.files.get(path);
    if (!workspace || !file) { setProblem({ message: `“${path}” is not in the open folder.` }); return false; }
    await readLocal(file, path, workspace);
    return true;
  }, [readLocal]);

  const fetchRemote = useCallback(async (rawUrl: string, quiet: boolean): Promise<ReaderDocument | undefined> => {
    let url: URL;
    try { url = new URL(rawUrl); } catch { if (!quiet) setProblem({ message: 'Enter a complete address that begins with https:// or http://.' }); return undefined; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      if (!quiet) setProblem({ message: 'Only http:// and https:// addresses without a user name or password can be opened.' });
      return undefined;
    }
    const pattern = `${url.origin}/*`;
    if (!(await browser.permissions.contains({ origins: [pattern] }).catch(() => false))) {
      if (!quiet) setProblem({ message: `Markdown Reader needs your permission to read documents from ${url.host}.`, recovery: 'grant-origin', origin: url.origin, url: url.href });
      return undefined;
    }
    const run = quiet ? undefined : begin();
    if (run) setLoading(true);
    try {
      const { text } = await readRemoteMarkdown(url, fetch, run ? { signal: run.signal } : {});
      if (run && !run.current()) return undefined;
      return { id: `remote:${url.href}`, name: documentNameFromUrl(url), source: url.href, sourceUrl: url.href, text, kind: 'remote' };
    } catch (reason) {
      if (!quiet && (!run || run.current()) && !(reason instanceof RemoteDocumentError && reason.kind === 'cancelled')) {
        setProblem({ message: reason instanceof Error ? reason.message : 'This address could not be loaded.' });
      }
      return undefined;
    } finally {
      if (run?.current()) setLoading(false);
    }
  }, [begin]);

  const openRemote = useCallback(async (rawUrl: string): Promise<boolean> => {
    const next = await fetchRemote(rawUrl, false);
    if (!next) return false;
    revokeAssets();
    setFolder(undefined);
    show(next);
    return true;
  }, [fetchRemote, revokeAssets, show]);

  const refreshRemote = useCallback(async (quiet: boolean): Promise<boolean> => {
    const current = documentRef.current;
    if (current?.kind !== 'remote') return false;
    const next = await fetchRemote(current.source, quiet);
    if (!next || documentRef.current?.source !== current.source || next.text === documentRef.current.text) return false;
    setDocument(next);
    return true;
  }, [fetchRemote]);

  /** A local file sent by automatic opening: read it directly, or use the handoff copy. */
  const openLocalUrl = useCallback(async (rawUrl: string, token: string | null): Promise<void> => {
    const url = parseLocalMarkdownUrl(rawUrl);
    if (!url) { setProblem({ message: 'This local address is not a Markdown file the reader can open.' }); return; }
    const [saved, access] = await Promise.all([loadSettings(), getLocalFileAccess()]);
    const state = localAutoOpenState(saved.autoOpenLocalFiles, access);
    if (state !== 'active') { setProblem({ message: localAccessMessages[state] }); return; }
    const run = begin();
    setLoading(true);
    let text: string | undefined;
    try {
      text = await readLocalMarkdown(url, fetch);
    } catch (reason) {
      if (reason instanceof LocalFileError && reason.kind === 'size') { setProblem({ message: reason.message }); setLoading(false); return; }
      // Firefox does not let extension pages read file URLs; the content script's copy is used there.
      text = token ? (await getLocalHandoff(token, url.href).catch(() => undefined))?.text : undefined;
      if (text === undefined) {
        if (run.current()) {
          setLoading(false);
          setProblem(import.meta.env.FIREFOX
            ? { message: 'Firefox no longer has this file’s text, which happens after the browser restarts. Go back to the file to open it again, or choose it with Open file.', recovery: 'history-back' }
            : { message: reason instanceof Error ? reason.message : 'This local file could not be read.' });
        }
        return;
      }
    }
    if (!run.current()) return;
    setLoading(false);
    const name = localFileNameFromUrl(url);
    show({ id: `local-url:${stableIdentifier(url.href)}`, name, source: name, text, kind: 'local' });
  }, [begin, show]);

  // Launch parameters: a hand-off from the popup, a local file, or a web address.
  // A pending document can be taken only once, so this runs once even in StrictMode.
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    const params = new URLSearchParams(window.location.search);
    const pending = params.get('pending');
    const launchUrl = params.get('url');
    if (pending) {
      void takePendingDocument(pending).then((item) => {
        if (!item) { setProblem({ message: 'This document is no longer available. Open it again from the popup or with Open file.' }); return; }
        show({
          id: item.kind === 'page' ? `page:${stableIdentifier(item.source)}` : fileDocumentId(item.name, item.size ?? item.text.length, item.lastModified ?? 0),
          name: item.name,
          source: item.source,
          text: item.text,
          kind: item.kind,
          ...(item.lastModified !== undefined ? { lastModified: item.lastModified } : {}),
          ...(item.size !== undefined ? { size: item.size } : {}),
        });
      }).catch(() => setProblem({ message: 'This document could not be opened. Open it again from the popup.' }));
    } else if (launchUrl?.startsWith('file:')) {
      void openLocalUrl(launchUrl, params.get('local')).catch(() => setProblem({ message: 'This local file could not be opened.' }));
    } else if (launchUrl) {
      void openRemote(launchUrl);
    }
  }, [openLocalUrl, openRemote, show]);

  return { document, folder, loading, problem, setProblem, openFile, openFolderFiles, openDirectoryPicker, openFolderPath, openRemote, refreshRemote };
}
