#!/usr/bin/env node
/**
 * Local dashboard: serves public/ and runs api/*.js against ./data — the
 * same handlers Vercel runs, without needing `vercel dev`.
 *
 *   npm run dev            → http://localhost:3000
 *   PORT=4000 npm run dev
 */
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR ||= join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z0-9-]+)$/);
    if (api) {
      const file = join(ROOT, 'api', `${api[1]}.js`);
      if (!existsSync(file)) { res.writeHead(404).end('no such route'); return; }
      const mod = await import(pathToFileURL(file).href);
      const handler = mod[req.method];
      if (!handler) { res.writeHead(405).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = resolve(ROOT, 'public', rel);
    if (!file.startsWith(join(ROOT, 'public')) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (err) {
    console.error(err);
    res.writeHead(500).end(String(err.message || err));
  }
}).listen(PORT, () => console.log(`intern-ops dashboard → http://localhost:${PORT}  (data: ${process.env.DATA_DIR})`));
