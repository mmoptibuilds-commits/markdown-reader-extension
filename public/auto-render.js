(() => {
  const markdownPath = /\.(?:md|markdown|mdx|mkd|mdown)$/iu.test(window.location.pathname);
  const markdownType = /^(?:text|application)\/(?:x-)?markdown(?:\s*;|$)/iu.test(document.contentType || '');
  if (!markdownPath && !markdownType) return;
  const extensionRuntime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  if (!extensionRuntime?.getURL) return;
  const reader = `${extensionRuntime.getURL('reader.html')}?url=${encodeURIComponent(window.location.href)}`;
  window.location.replace(reader);
})();
