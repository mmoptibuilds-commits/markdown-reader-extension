import { parse as parseYaml } from 'yaml';

export type DocumentFormat = 'markdown' | 'text' | 'unsupported';

export interface HeadingDraft {
  level: number;
  text: string;
}

export interface Heading extends HeadingDraft {
  id: string;
}

export interface FrontmatterResult {
  body: string;
  metadata: Record<string, unknown>;
  error?: string;
}

const markdownExtensions = new Set(['md', 'markdown', 'mdx', 'mkd', 'mkdn', 'mdown', 'mdwn']);
const markdownMimeTypes = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/md',
  'application/markdown',
  'application/x-markdown',
]);

/** Returns true for a Markdown media type, ignoring parameters and case. */
export function isMarkdownMimeType(mimeType: string): boolean {
  return markdownMimeTypes.has(mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '');
}

/** Returns true when a pathname (already decoded or not) ends in a Markdown extension. */
export function hasMarkdownExtension(pathname: string): boolean {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* Keep the raw path for malformed escapes. */ }
  const extension = decoded.slice(decoded.lastIndexOf('.') + 1).toLowerCase();
  return decoded.lastIndexOf('.') > decoded.lastIndexOf('/') && markdownExtensions.has(extension);
}
const htmlMimeTypes = new Set(['text/html', 'application/xhtml+xml']);
const unsafeObjectKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A file the reader opens from a picker or drop: any Markdown extension, or .txt chosen on purpose. */
export function isOpenableFileName(name: string): boolean {
  return hasMarkdownExtension(name) || /\.txt$/iu.test(name);
}

/** The `accept` list for file inputs, matching {@link isOpenableFileName}. */
export const OPENABLE_FILE_ACCEPT = '.md,.markdown,.mdx,.mkd,.mkdn,.mdown,.mdwn,.txt,text/markdown,text/plain';

export function classifyDocument(
  source: string,
  mimeType?: string,
  explicitlyOpened = false,
): DocumentFormat {
  const contentType = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  // A web page is never Markdown, even when its address ends in .md.
  if (contentType && htmlMimeTypes.has(contentType)) return 'unsupported';
  if (contentType && markdownMimeTypes.has(contentType)) return 'markdown';

  let pathname = source;
  try {
    pathname = new URL(source).pathname;
  } catch {
    pathname = source.split(/[?#]/, 1)[0] ?? source;
  }

  const extension = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
  if (markdownExtensions.has(extension)) return 'markdown';
  if (extension === 'txt' && explicitlyOpened) return 'text';
  if (explicitlyOpened && !extension) return 'text';
  return 'unsupported';
}

export function isSafeLink(href: string): boolean {
  const value = href.trim();
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return false;

  const scheme = value.match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase();
  if (scheme) return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';

  try {
    return ['http:', 'https:'].includes(new URL(value, 'https://reader.invalid/').protocol);
  } catch {
    return false;
  }
}

export function slugifyHeadingText(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-');

  return slug || 'section';
}

export function buildHeadingIndex(drafts: readonly HeadingDraft[]): Heading[] {
  const used = new Set<string>();

  return drafts.map(({ level, text }) => {
    const base = `md-${slugifyHeadingText(text)}`;
    let id = base;
    let suffix = 1;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { id, level, text: text.trim() };
  });
}

function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeMetadata(item, depth + 1));
  if (typeof value !== 'object') return null;

  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!unsafeObjectKeys.has(key)) safe[key] = sanitizeMetadata(item, depth + 1);
  }
  return safe;
}

export function parseFrontmatter(source: string): FrontmatterResult {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return { body: source, metadata: {} };

  const rawYaml = match[1] ?? '';
  if (rawYaml.length > 65_536) {
    return { body: source, metadata: {}, error: 'Frontmatter is larger than 64 KB.' };
  }

  try {
    const parsed: unknown = parseYaml(rawYaml, { maxAliasCount: 50 });
    if (parsed === null || parsed === undefined) {
      return { body: source.slice(match[0].length), metadata: {} };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { body: source, metadata: {}, error: 'Frontmatter must contain a YAML mapping.' };
    }

    const clean = sanitizeMetadata(parsed);
    if (!isRecordObject(clean)) {
      return { body: source, metadata: {}, error: 'Frontmatter must contain a YAML mapping.' };
    }
    return { body: source.slice(match[0].length), metadata: clean };
  } catch {
    return { body: source, metadata: {}, error: 'Frontmatter could not be parsed as YAML.' };
  }
}

export function findTextMatches(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const haystack = text.toLowerCase();
  const matches: number[] = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    matches.push(found);
    offset = found + needle.length;
  }
  return matches;
}

export function normalizeRelativePath(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.replace(/\\/gu, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

export function resolveFolderTarget(sourcePath: string, href: string): { path: string; hash: string } | undefined {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^[a-z][a-z\d+.-]*:/iu.test(trimmed) || trimmed.startsWith('//')) {
    return undefined;
  }

  const hashAt = trimmed.indexOf('#');
  const hash = hashAt < 0 ? '' : trimmed.slice(hashAt);
  const beforeHash = hashAt < 0 ? trimmed : trimmed.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const encodedPath = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const source = sourcePath.split(/[?#]/u, 1)[0] ?? sourcePath;
  const directory = source.replace(/\\/gu, '/').split('/').slice(0, -1).join('/');

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }

  const path = normalizeRelativePath([directory, relativePath].filter(Boolean).join('/'));
  return path ? { path, hash } : undefined;
}
