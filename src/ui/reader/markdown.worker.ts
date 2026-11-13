/// <reference lib="webworker" />
import { prepareMarkdown, type RenderMarkdownOptions } from '../../core/markdown';

/**
 * Parses and renders Markdown off the main thread. It returns unsanitized HTML slices;
 * the page sanitizes each slice with DOMPurify, which needs a real DOM, before inserting it.
 */
self.addEventListener('message', (event: MessageEvent<{ id: number; source: string; options: RenderMarkdownOptions }>) => {
  const { id, source, options } = event.data;
  prepareMarkdown(source, options).then(
    (prepared) => self.postMessage({ id, prepared }),
    (error: unknown) => self.postMessage({ id, error: error instanceof Error ? error.message : 'This document could not be rendered.' }),
  );
});
