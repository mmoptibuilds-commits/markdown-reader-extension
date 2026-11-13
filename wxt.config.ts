import { defineConfig } from 'wxt';

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
  manifestVersion: 3,
  outDir: e2eBuild ? '.output-e2e' : '.output',
  manifest: ({ browser }) => ({
    name: 'Markdown Reader',
    short_name: 'Markdown Reader',
    description: 'A quiet, local-first space for reading Markdown.',
    icons: {
      16: 'icon-16.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    permissions: ['activeTab', 'scripting', 'storage', 'clipboardWrite'],
    host_permissions: [...localFileHostPermissions, ...(e2eBuild ? e2eHostPermissions : [])],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // Automatic opening sends a web page to reader.html with location.replace(). Chrome
    // blocks that navigation to an extension page unless the page is web-accessible.
    // Chrome's dynamic URL keeps the extension ID from being predictable to sites.
    // A local Markdown file reaches the reader the same way, so file URLs are matched too.
    web_accessible_resources: [{
      resources: ['reader.html'],
      matches: ['http://*/*', 'https://*/*', 'file:///*'],
      ...(browser === 'firefox' ? {} : { use_dynamic_url: true }),
    }],
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
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http: https:; connect-src 'self' http: https:",
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'markdown-reader@local.invalid',
              data_collection_permissions: { required: ['none'] },
              strict_min_version: '128.0',
            },
          },
        }
      : {}),
  }),
});
