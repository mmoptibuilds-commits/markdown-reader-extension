// Real-Firefox checks of the popup, reader, settings, diagrams, and remote documents.
//
// Usage: npm run test:firefox  (builds .output/firefox-mv3 first)
// Set FIREFOX_BIN to the Firefox executable; it defaults to `firefox` on PATH.
import assert from 'node:assert/strict';
import path from 'node:path';
import { delay, launchFirefox, waitFor } from './bidi.mjs';
import { createReporter, startDocumentServer } from './harness.mjs';

const ADDON_ID = 'markdown-reader@local.invalid';
const UUID = '6d1b6f1e-3c1a-4b7a-9d55-2f0e8e3a1c42';
const EXTENSION = `moz-extension://${UUID}`;
// The test build grants http://127.0.0.1/* only, so remote-document checks need no native prompt.
const extensionDir = path.resolve('.output-e2e/firefox-mv3');
const { check, finish } = createReporter();

const server = await startDocumentServer();
const firefox = await launchFirefox({ binary: process.env.FIREFOX_BIN || 'firefox', addonUuids: { [ADDON_ID]: UUID } });
console.log(`Firefox ${firefox.version}`);
try {
  await firefox.send('webExtension.install', { extensionData: { type: 'path', path: extensionDir } });
  const tab = (await firefox.topContexts())[0].context;
  const text = (context, selector) => firefox.evaluate(context, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const logErrors = [];
  const pageErrors = async (context) => firefox.evaluate(context, 'JSON.stringify(window.__errors ?? [])');
  const open = async (context, url) => { await firefox.send('browsingContext.navigate', { context, url, wait: 'complete' }).catch(() => undefined); };
  const withErrorCapture = (context) => firefox.evaluate(context, `window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(e.message)); document.addEventListener('securitypolicyviolation', (e) => window.__errors.push('CSP: ' + e.violatedDirective + ' ' + e.blockedURI)); true`);

  await check('the extension pages load without errors', async () => {
    for (const page of ['popup.html', 'options.html', 'reader.html']) {
      const context = await firefox.openTab(`${EXTENSION}/${page}`);
      await waitFor(() => firefox.evaluate(context, 'document.querySelector("#root")?.children.length > 0'), `${page} rendered`);
      await firefox.send('browsingContext.close', { context }).catch(() => undefined);
    }
  });

  await check('Settings opens with six sections, the theme gallery, and a saved theme change', async () => {
    const settings = await firefox.openTab(`${EXTENSION}/options.html`);
    await waitFor(() => firefox.evaluate(settings, 'document.querySelectorAll(".settings-nav a").length === 6'), 'six sections');
    assert.equal(await firefox.evaluate(settings, 'document.querySelectorAll(".theme-option").length >= 10'), true, 'ten built-in themes');
    await firefox.evaluate(settings, 'document.querySelector(".theme-option input[value=nord]").click(); true');
    await waitFor(async () => (await firefox.evaluate(settings, 'document.documentElement.dataset.theme')) === 'nord', 'theme applied');
    const stored = await firefox.evaluate(settings, 'browser.storage.local.get("markdownReaderSettings").then((v) => v.markdownReaderSettings.theme)');
    assert.equal(stored, 'nord');
    await firefox.send('browsingContext.close', { context: settings }).catch(() => undefined);
  });

  await check('a custom theme can be created without deleting an existing one', async () => {
    const settings = await firefox.openTab(`${EXTENSION}/options.html`);
    await waitFor(() => firefox.evaluate(settings, 'document.querySelector(".custom-themes") !== null'), 'custom themes');
    const create = (name) => firefox.evaluate(settings, `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const setValue = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
      [...document.querySelectorAll('.custom-themes-head button')].find((b) => b.textContent.includes('New theme')).click();
      await wait(100);
      setValue(document.querySelector('.theme-editor input[maxlength="40"]'), ${JSON.stringify(name)});
      await wait(100);
      document.querySelector('.theme-editor button[type=submit]').click();
      await wait(800);
      return document.querySelectorAll('.custom-theme-list li').length;
    })()`);
    assert.equal(await create('First'), 1);
    assert.equal(await create('Second'), 2);
    await firefox.send('browsingContext.close', { context: settings }).catch(() => undefined);
  });

  await check('the popup shows the theme gallery and an Open file action', async () => {
    const popup = await firefox.openTab(`${EXTENSION}/popup.html`);
    await waitFor(() => firefox.evaluate(popup, 'document.querySelectorAll(".theme-option").length >= 12'), 'themes including custom');
    assert.match(await text(popup, '.popup-actions'), /Open file/u);
    await firefox.send('browsingContext.close', { context: popup }).catch(() => undefined);
  });

  await check('the reader draws Mermaid, Graphviz, and math with no CSP violation', async () => {
    const reader = await firefox.openTab(`${EXTENSION}/reader.html`);
    await waitFor(() => firefox.evaluate(reader, 'document.querySelector("#root")?.children.length > 0'), 'reader');
    await withErrorCapture(reader);
    await firefox.evaluate(reader, `(async () => { const f = document.querySelector('#remote-url'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, ${JSON.stringify(`${server.origin}/diagram.md`)}); f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); f.form.querySelector('button[type=submit]').click(); return true; })()`);
    await waitFor(() => firefox.evaluate(reader, 'document.querySelectorAll("[data-diagram] svg").length === 2'), 'both diagrams', 30_000);
    assert.equal(await firefox.evaluate(reader, 'document.querySelector(".katex") !== null'), true, 'math rendered');
    assert.equal(await pageErrors(reader), '[]');
    await firefox.send('browsingContext.close', { context: reader }).catch(() => undefined);
  });

  await check('an online document opens after site access, with no extra request', async () => {
    const reader = await firefox.openTab(`${EXTENSION}/reader.html?url=${encodeURIComponent(`${server.origin}/doc.md`)}`);
    await waitFor(async () => /Remote document/u.test(await text(reader, '.markdown-body h1')), 'remote document');
    await firefox.send('browsingContext.close', { context: reader }).catch(() => undefined);
  });

  await check('a redirect is refused and the redirect target is never contacted', async () => {
    server.hits.length = 0;
    const reader = await firefox.openTab(`${EXTENSION}/reader.html?url=${encodeURIComponent(`${server.origin}/redirect.md`)}`);
    await waitFor(async () => /redirects to another location/u.test(await text(reader, '.reader-problem')), 'redirect message');
    assert.ok(!server.hits.includes('/final.md'), `final target was contacted: ${server.hits}`);
    await firefox.send('browsingContext.close', { context: reader }).catch(() => undefined);
  });

  await check('a site without access shows an Allow access recovery, not a fetch', async () => {
    server.hits.length = 0;
    const other = await startDocumentServer();
    // localhost is a different origin from 127.0.0.1, so it has no access.
    const ungranted = other.origin.replace('127.0.0.1', 'localhost');
    const reader = await firefox.openTab(`${EXTENSION}/reader.html?url=${encodeURIComponent(`${ungranted}/doc.md`)}`);
    await waitFor(async () => /needs your permission/u.test(await text(reader, '.reader-problem')), 'permission message');
    assert.match(await text(reader, '.reader-problem'), /Allow access/u);
    assert.equal(other.hits.length, 0, 'the server was not contacted');
    await firefox.send('browsingContext.close', { context: reader }).catch(() => undefined);
    await other.close();
  });

  await check('automatic opening works for an enabled site, and not for HTML at a .md path', async () => {
    const options = await firefox.openTab(`${EXTENSION}/options.html`);
    await waitFor(() => firefox.evaluate(options, 'typeof browser !== "undefined" && document.querySelector("#root")?.children.length > 0'), 'options page');
    await firefox.evaluate(options, `browser.storage.local.set({ markdownReaderAutoRenderOrigins: [${JSON.stringify(server.origin)}] }).then(() => browser.runtime.sendMessage({ type: 'markdown-reader:update-auto-render' }))`);
    await delay(800);
    await open(tab, `${server.origin}/typed.md`);
    await waitFor(async () => (await firefox.url(tab)).startsWith(`${EXTENSION}/reader.html`), 'redirect to the reader');
    await waitFor(async () => /Typed Markdown/u.test(await text(tab, '.markdown-body h1')), 'typed document');
    await open(tab, `${server.origin}/page.md`);
    await delay(1500);
    assert.equal(await firefox.url(tab), `${server.origin}/page.md`);
  });

  await check('the reader page is not reachable from a web page', async () => {
    await open(tab, `${server.origin}/page.md`);
    const result = await firefox.evaluate(tab, `fetch(${JSON.stringify(`${EXTENSION}/reader.html`)}).then(() => 'reachable', () => 'blocked')`);
    assert.equal(result, 'blocked');
  });

  await check('the background page can be terminated and automatic opening still works', async () => {
    await firefox.chromeEval(`(async () => { await WebExtensionPolicy.getByID(${JSON.stringify(ADDON_ID)}).extension.terminateBackground(); return true; })()`);
    await open(tab, `${server.origin}/typed.md`);
    await waitFor(async () => (await firefox.url(tab)).startsWith(`${EXTENSION}/reader.html`), 'redirect after termination');
  });
} finally {
  await firefox.close();
  await server.close();
}
finish();
