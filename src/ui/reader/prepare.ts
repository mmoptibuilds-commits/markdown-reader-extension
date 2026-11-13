import type { PreparedMarkdown, RenderMarkdownOptions } from '../../core/markdown';

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (value: PreparedMarkdown) => void; reject: (error: Error) => void }>();

function startWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
  created.addEventListener('message', (event: MessageEvent<{ id: number; prepared?: PreparedMarkdown; error?: string }>) => {
    const entry = waiting.get(event.data.id);
    if (!entry) return;
    waiting.delete(event.data.id);
    if (event.data.prepared) entry.resolve(event.data.prepared);
    else entry.reject(new Error(event.data.error ?? 'This document could not be rendered.'));
  });
  created.addEventListener('error', () => {
    for (const entry of waiting.values()) entry.reject(new Error('The renderer stopped unexpectedly. Reload the page to try again.'));
    waiting.clear();
    created.terminate();
    if (worker === created) worker = undefined;
  });
  worker = created;
  return created;
}

/**
 * Parses and renders a document in a worker, so even very large documents never block
 * the page. Markdown parsing needs no DOM; the page sanitizes the returned slices.
 */
export function prepareDocument(source: string, options: RenderMarkdownOptions): Promise<PreparedMarkdown> {
  const target = startWorker();
  const id = ++nextId;
  return new Promise<PreparedMarkdown>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    target.postMessage({ id, source, options });
  });
}
