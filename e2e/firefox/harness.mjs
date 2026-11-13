// Shared pieces of the Firefox runtime checks: result reporting and a loopback document server.
import { createServer } from 'node:http';

export function createReporter() {
  const results = [];
  return {
    results,
    async check(name, run) {
      try {
        await run();
        results.push({ name, ok: true });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        results.push({ name, ok: false });
        console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    finish() {
      const failed = results.filter((result) => !result.ok);
      console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
      process.exitCode = failed.length ? 1 : 0;
    },
  };
}

/** A loopback server for remote-document checks. `hits` records every path requested. */
export async function startDocumentServer() {
  const hits = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    hits.push(url.pathname);
    const send = (status, type, body, extra = {}) => { response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra }); response.end(body); };
    if (url.pathname === '/doc.md') return send(200, 'text/plain; charset=utf-8', '# Remote document\n\nServed as plain text.\n');
    if (url.pathname === '/typed.md') return send(200, 'text/markdown; charset=utf-8', '# Typed Markdown\n');
    if (url.pathname === '/page.md') return send(200, 'text/html; charset=utf-8', '<!doctype html><h1>HTML at a .md path</h1>');
    if (url.pathname === '/redirect.md') return send(302, 'text/plain', '', { location: '/final.md' });
    if (url.pathname === '/final.md') return send(200, 'text/plain; charset=utf-8', '# Final target\n');
    if (url.pathname === '/diagram.md') return send(200, 'text/plain; charset=utf-8', '# Diagrams\n\n```mermaid\ngraph TD; A[Start] --> B[End]\n```\n\n```dot\ndigraph G { A -> B; }\n```\n\nInline math $e^{i\\pi}+1=0$.\n');
    return send(404, 'text/plain', 'Not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}
