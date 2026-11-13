import type { AtRule, Plugin } from 'postcss';
import { defineConfig } from 'wxt';

/**
 * KaTeX lists woff2, woff, and ttf for every font. Every browser this extension supports
 * uses woff2, so the other formats are dropped and never copied into the package.
 */
const katexWoff2Only: Plugin = {
  postcssPlugin: 'katex-woff2-only',
  AtRule: {
    'font-face': (rule: AtRule) => {
      rule.walkDecls('src', (declaration) => {
        if (!declaration.value.includes('KaTeX_')) return;
        declaration.value = declaration.value.split(/,(?=\s*url\()/u).filter((source) => /\.woff2\b/u.test(source)).join(',');
      });
    },
  },
};

// Set MARKDOWN_READER_E2E=1 to build the test variant. It grants the local test origin
// host access so the runtime suite can exercise automatic opening without a native
// permission prompt. The variant goes to a separate output folder and is never packaged.
const e2eBuild = process.env.MARKDOWN_READER_E2E === '1';
const e2eHostPermissions = ['http://127.0.0.1/*'];
// Local automatic opening. Chromium injects into file URLs only with this host permission
// and only after the user turns on "Allow access to file URLs"; Firefox 153+ also requires
// its "Access local files" permission. Neither browser shows an install warning for it.
const localFileHostPermissions = ['file:///*'];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // ES workers can share chunks with the page; the default IIFE format would inline them.
  vite: () => ({ css: { postcss: { plugins: [katexWoff2Only] } }, worker: { format: 'es' } }),
  manifestVersion: 3,
  outDir: e2eBuild ? '.output-e2e' : '.output',
  manifest: ({ browser }) => ({
    name: 'Markdown Reader',
    short_name: 'Markdown Reader',
    description: 'Read local and online Markdown in a clean, private reader. Nothing is uploaded.',
    ...(browser === 'firefox' ? {} : { minimum_chrome_version: '120' }),
    icons: {
      16: 'icon-16.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: [...localFileHostPermissions, ...(e2eBuild ? e2eHostPermissions : [])],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // No web_accessible_resources: automatic opening asks the background worker to move
    // the tab into the reader (tabs.update), so no web page can open or frame the reader.
    action: {
      default_title: 'Open Markdown Reader',
      default_icon: {
        16: 'icon-16.png',
        48: 'icon-48.png',
      },
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+M' },
        description: 'Open Markdown Reader',
      },
    },
    content_security_policy: {
      extension_pages:
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; font-src 'self' data:; connect-src 'self' http: https:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'markdown-reader@local.invalid',
              data_collection_permissions: { required: ['none'] },
              // data_collection_permissions needs 140. Local automatic opening needs 153 and
              // reports itself unavailable on older versions.
              strict_min_version: '140.0',
            },
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {}),
  }),
});
