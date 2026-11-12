// Real-Firefox check of local Markdown automatic opening.
//
// Usage: npm run test:firefox  (builds .output/firefox-mv3 first)
// Set FIREFOX_BIN to the Firefox executable; it defaults to `firefox` on PATH.
//
// The extension is installed as a temporary add-on. File access is granted and revoked
// through the real about:addons "Access local files on your computer" switch.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { delay, launchFirefox, waitFor } from './bidi.mjs';

const ADDON_ID = 'markdown-reader@local.invalid';
const UUID = '6d1b6f1e-3c1a-4b7a-9d55-2f0e8e3a1c42';
const EXTENSION = `moz-extension://${UUID}`;
const extensionDir = path.resolve('.output/firefox-mv3');
const docsDir = path.resolve('test-results/firefox-local-docs');

const docs = {
  'Guide.md': '# Local guide\n\nRead from a file URL.\n',
  'deep/nested folder/Übersicht – 日本 notes.md': '# Übersicht 日本\n\nNested, with spaces and Unicode.\n',
  'formats/a.markdown': '# Format markdown\n',
  'formats/a.mkd': '# Format mkd\n',
  'formats/a.mkdn': '# Format mkdn\n',
  'formats/a.mdown': '# Format mdown\n',
  'formats/a.mdwn': '# Format mdwn\n',
  'formats/a.mdx': '# Format mdx\n',
  'page.html': '<!doctype html><title>Local HTML</title><h1>Local HTML page</h1>',
  'notes.txt': '# Text file\n',
  'hostile.md': '# Hostile document\n\n<script>window.__pwned = 1</script>\n<img src="x" onerror="window.__pwned = 2">\n',
};

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeDocs() {
  await rm(docsDir, { recursive: true, force: true });
  for (const [relative, content] of Object.entries(docs)) {
    const target = path.join(docsDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const section = (index) => `## Section ${index}\n\n${'Long reading text with **emphasis** and `code`. '.repeat(50)}\n\n`;
  await writeFile(path.join(docsDir, 'large.md'), `# Large document\n\n${Array.from({ length: 1100 }, (_, index) => section(index)).join('')}## Last section\n`);
  await writeFile(path.join(docsDir, 'too-large.md'), `# Too large\n\n${'x'.repeat(5 * 1024 * 1024)}\n`);
}
const fileUrl = (relative) => pathToFileURL(path.join(docsDir, relative)).href;

const firefox = await launchFirefox({ binary: process.env.FIREFOX_BIN || 'firefox', addonUuids: { [ADDON_ID]: UUID } });
console.log(`Firefox ${firefox.version}`);
try {
  await writeDocs();
  await firefox.send('webExtension.install', { extensionData: { type: 'path', path: extensionDir } });
  const tab = (await firefox.topContexts())[0].context;
  const options = await firefox.openTab(`${EXTENSION}/options.html#files`);
  await waitFor(() => firefox.evaluate(options, 'document.querySelector(".local-file-status") !== null'), 'settings page');

  const inOptions = (expression) => firefox.evaluate(options, expression);
  /** Flips the real Settings switch, the way a user would. */
  const setOptIn = async (on) => {
    await inOptions(`(() => {
      const label = [...document.querySelectorAll('label.toggle-setting')].find((item) => item.textContent.includes('Automatically open local Markdown files'));
      const input = label.querySelector('input');
      if (input.checked !== ${on}) input.click();
      return true;
    })()`);
    // The background worker re-syncs on the settings change; wait until it has.
    await waitFor(async () => (await inOptions('browser.scripting.getRegisteredContentScripts().then((items) => items.some((item) => item.matches.includes("file:///*")))')) === on, `registration ${on}`);
  };
  const fileAccess = () => inOptions('browser.extension.isAllowedFileSchemeAccess()');
  const settingsState = async () => {
    await inOptions('window.dispatchEvent(new Event("focus")), true');
    await delay(300);
    return inOptions('document.querySelector(".local-file-status").dataset.state');
  };
  const open = async (url) => {
    await firefox.send('browsingContext.navigate', { context: tab, url, wait: 'complete' }).catch(() => undefined);
  };
  // Headings carry a trailing "#" permalink.
  const readerHeading = () => firefox.evaluate(tab, 'location.protocol === "moz-extension:" ? (document.querySelector("h1")?.textContent ?? "").replace(/#$/u, "").trim() : ""');
  const readerError = () => firefox.evaluate(tab, 'location.protocol === "moz-extension:" ? (document.querySelector(".reader-error")?.textContent ?? "") : ""');
  const expectReader = async (heading) => {
    await waitFor(async () => (await readerHeading()) === heading, `reader heading "${heading}"`, 30_000);
  };
  const expectStays = async (url) => {
    await delay(1500);
    assert.equal(await firefox.url(tab), url);
  };

  /** Flips the real about:addons switch for "Access local files on your computer". */
  const setFileAccessInAddonsManager = async (allowed) => {
    const addons = await firefox.openTab(`about:addons`);
    await delay(500);
    const toggled = await firefox.chromeEval(`(async () => {
      const browserEl = gBrowser.selectedBrowser;
      const win = browserEl.contentWindow;
      await win.loadView(${JSON.stringify(`addons://detail/${encodeURIComponent(ADDON_ID)}/permissions`)});
      for (let i = 0; i < 50; i += 1) {
        const toggle = win.document.querySelector('moz-toggle[permission-type="file_scheme_access"]');
        if (toggle) {
          if (toggle.pressed !== ${allowed}) toggle.buttonEl.click();
          await new Promise((resolve) => win.setTimeout(resolve, 500));
          return toggle.getAttribute('label') + ' => ' + toggle.pressed;
        }
        await new Promise((resolve) => win.setTimeout(resolve, 100));
      }
      return 'missing';
    })()`);
    await firefox.send('browsingContext.close', { context: addons }).catch(() => undefined);
    assert.notEqual(toggled, 'missing', 'about:addons shows the local-files switch');
    console.log(`    about:addons: ${toggled}`);
    await waitFor(async () => (await fileAccess()) === allowed, `file access ${allowed}`);
  };

  await check('Firefox reports no file access before the user grants it', async () => {
    assert.equal(await fileAccess(), false);
  });

  await check('does nothing until the user opts in', async () => {
    await open(fileUrl('Guide.md'));
    await expectStays(fileUrl('Guide.md'));
  });

  await check('with the opt-in but no file access: stays put and Settings asks for permission', async () => {
    await setOptIn(true);
    assert.equal(await settingsState(), 'permission-required');
    const text = await inOptions('document.querySelector(".local-file-status").textContent');
    assert.match(text, /Access local files on your computer/u);
    assert.equal(await inOptions('document.querySelector(".local-file-status button") === null'), true, 'no chrome:// link in Firefox');
    await open(fileUrl('Guide.md'));
    await expectStays(fileUrl('Guide.md'));
  });

  await check('granting access in about:addons makes Settings report it active', async () => {
    await setFileAccessInAddonsManager(true);
    assert.equal(await settingsState(), 'active');
  });

  await check('opens a local Markdown file through the handoff', async () => {
    await open(fileUrl('Guide.md'));
    await expectReader('Local guide');
    const launched = new URL(await firefox.url(tab));
    assert.equal(launched.searchParams.get('url'), fileUrl('Guide.md'));
    assert.ok(launched.searchParams.get('local'), 'a handoff token is present');
  });

  await check('opens a nested file with spaces and Unicode', async () => {
    await open(fileUrl('deep/nested folder/Übersicht – 日本 notes.md'));
    await expectReader('Übersicht 日本');
  });

  for (const extension of ['markdown', 'mkd', 'mkdn', 'mdown', 'mdwn', 'mdx']) {
    await check(`opens .${extension} when Firefox displays it`, async () => {
      await open(fileUrl(`formats/a.${extension}`));
      await expectReader(`Format ${extension}`);
    });
  }

  await check('leaves HTML and text files alone', async () => {
    for (const file of ['page.html', 'notes.txt']) {
      await open(fileUrl(file));
      await expectStays(fileUrl(file));
    }
  });

  await check('reload keeps the document', async () => {
    await open(fileUrl('Guide.md'));
    await expectReader('Local guide');
    await firefox.send('browsingContext.reload', { context: tab, wait: 'complete' });
    await expectReader('Local guide');
  });

  await check('back and forward work without a redirect loop', async () => {
    await open(fileUrl('page.html'));
    await open(fileUrl('Guide.md'));
    await expectReader('Local guide');
    await firefox.send('browsingContext.traverseHistory', { context: tab, delta: -1 });
    await waitFor(async () => (await firefox.url(tab)) === fileUrl('page.html'), 'back to page.html');
    await firefox.send('browsingContext.traverseHistory', { context: tab, delta: 1 });
    await expectReader('Local guide');
  });

  await check('keeps working after the background page is terminated', async () => {
    await firefox.chromeEval(`(async () => { await WebExtensionPolicy.getByID(${JSON.stringify(ADDON_ID)}).extension.terminateBackground(); return true; })()`);
    await open(fileUrl('Guide.md'));
    await expectReader('Local guide');
  });

  await check('renders a hostile document without executing it', async () => {
    await open(fileUrl('hostile.md'));
    await expectReader('Hostile document');
    await delay(800);
    assert.equal(await firefox.evaluate(tab, 'window.__pwned === undefined && document.querySelectorAll(".markdown-body script, .markdown-body [onerror]").length === 0'), true);
  });

  await check('opens a large (about 3 MB) document', async () => {
    const started = Date.now();
    await open(fileUrl('large.md'));
    await expectReader('Large document');
    console.log(`    large document shown after ${Date.now() - started} ms`);
  });

  await check('explains why a file over the 4 MB handoff limit cannot open automatically', async () => {
    await open(fileUrl('too-large.md'));
    await waitFor(async () => /larger than 4 MB/u.test(await readerError()), 'size message', 30_000);
  });

  await check('revoking access in about:addons stops automatic opening', async () => {
    await setFileAccessInAddonsManager(false);
    assert.equal(await settingsState(), 'permission-required');
    await open(fileUrl('Guide.md'));
    await expectStays(fileUrl('Guide.md'));
  });

  await check('turning the opt-in off stops automatic opening even with access granted', async () => {
    await setFileAccessInAddonsManager(true);
    await setOptIn(false);
    assert.equal(await settingsState(), 'disabled');
    await open(fileUrl('Guide.md'));
    await expectStays(fileUrl('Guide.md'));
  });
} finally {
  await firefox.close();
  await rm(docsDir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exitCode = failed.length ? 1 : 0;
