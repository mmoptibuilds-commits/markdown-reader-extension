// A minimal WebDriver BiDi client for driving a real Firefox in the local-file runtime check.
// It uses only Node built-ins (WebSocket is global in Node 22), so the project gains no
// dependency. Playwright's Firefox build cannot install extensions, so this talks to the
// installed Firefox directly.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts Firefox with a fresh profile. `addonUuids` fixes each add-on's moz-extension UUID
 * so pages can be addressed. System access is needed only to open extension pages in tabs
 * and to drive about:addons, which BiDi cannot navigate to directly.
 */
export async function launchFirefox({ binary, addonUuids = {}, prefs = {} }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'markdown-reader-firefox-'));
  const allPrefs = {
    'extensions.webextensions.uuids': JSON.stringify(addonUuids),
    'browser.shell.checkDefaultBrowser': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.enabled': false,
    'app.update.enabled': false,
    ...prefs,
  };
  await writeFile(path.join(profile, 'user.js'), Object.entries(allPrefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const child = spawn(binary, ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${port}`], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
  });

  let socket;
  for (let attempt = 0; attempt < 150 && !socket; attempt += 1) {
    try {
      const candidate = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((resolve, reject) => { candidate.onopen = resolve; candidate.onerror = reject; });
      socket = candidate;
    } catch {
      await delay(200);
    }
  }
  if (!socket) { child.kill(); throw new Error('Firefox did not open a WebDriver BiDi port.'); }

  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const waiter = message.id ? pending.get(message.id) : undefined;
    if (!waiter) return;
    pending.delete(message.id);
    if (message.type === 'error') waiter.reject(new Error(`${message.error}: ${message.message}`));
    else waiter.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  const session = await send('session.new', { capabilities: {} });

  const evaluate = async (context, expression) => {
    const result = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' });
    if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const chromeContext = async () => (await send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts[0].context;
  const chromeEval = async (expression) => evaluate(await chromeContext(), expression);
  const topContexts = async () => (await send('browsingContext.getTree', {})).contexts;

  return {
    version: session.capabilities.browserVersion,
    send,
    evaluate,
    chromeEval,
    topContexts,
    /** Opens a URL (including moz-extension: and about: pages) in a new tab and returns its context. */
    async openTab(url) {
      const before = new Set((await topContexts()).map(({ context }) => context));
      await chromeEval(`gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); true`);
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const created = (await topContexts()).find(({ context }) => !before.has(context));
        if (created) return created.context;
        await delay(100);
      }
      throw new Error(`No tab opened for ${url}`);
    },
    async url(context) {
      return (await topContexts()).find((item) => item.context === context)?.url;
    },
    async close() {
      try { await send('browser.close'); } catch { /* Already closing. */ }
      child.kill();
      await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Polls `read` until it returns a truthy value, or throws with the last value seen. */
export async function waitFor(read, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

export { delay };
