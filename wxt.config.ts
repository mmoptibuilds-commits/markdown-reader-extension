import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
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
    optional_host_permissions: ['http://*/*', 'https://*/*'],
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
