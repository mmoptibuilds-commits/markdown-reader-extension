export interface ReaderDocument {
  id: string;
  name: string;
  /** What the toolbar shows as the origin: a folder path, URL, or file name. */
  source: string;
  text: string;
  kind: 'local' | 'remote' | 'page';
  /** The address relative links and images resolve against (remote documents only). */
  sourceUrl?: string;
  /** The document's path inside the open folder. */
  documentPath?: string;
  lastModified?: number;
  size?: number;
}

export interface FolderWorkspace {
  name: string;
  files: ReadonlyMap<string, File>;
  assets: ReadonlyMap<string, string>;
}

/** A problem shown in the reader, with an optional way to recover from it. */
export interface ReaderProblem {
  message: string;
  /** "history-back" returns to the original file tab entry (Firefox restart recovery). */
  recovery?: 'history-back' | 'grant-origin';
  /** The origin to request when recovery is "grant-origin". */
  origin?: string;
  url?: string;
}
