type MarkdownItPlugin = (markdown: import('markdown-it').MarkdownIt) => void;

declare module 'markdown-it-abbr' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-container' {
  interface ContainerOptions {
    render?: (tokens: import('markdown-it').Token[], index: number) => string;
  }
  const plugin: (markdown: import('markdown-it').MarkdownIt, name: string, options?: ContainerOptions) => void;
  export default plugin;
}

declare module 'markdown-it-deflist' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-emoji' {
  export const bare: MarkdownItPlugin;
  export const full: MarkdownItPlugin;
  export const light: MarkdownItPlugin;
}

declare module 'markdown-it-footnote' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-ins' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-mark' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-sub' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-sup' {
  const plugin: MarkdownItPlugin;
  export default plugin;
}

declare module 'markdown-it-task-lists' {
  const plugin: (markdown: import('markdown-it').MarkdownIt, options?: { enabled?: boolean; label?: boolean }) => void;
  export default plugin;
}
