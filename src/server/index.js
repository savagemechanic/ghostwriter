import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JsonStore } from '../core/store.js';
import { GhostwriterService } from '../core/service.js';
import { OpenAICompatibleTextProvider } from '../adapters/ai.js';
import { InstagramPublisher } from '../adapters/instagram.js';

const port = Number(process.env.PORT ?? 8787);
const store = new JsonStore(process.env.GHOSTWRITER_DATA_DIR ?? './data');
const ai = new OpenAICompatibleTextProvider({ apiUrl: process.env.AI_API_URL, apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL });
const instagram = new InstagramPublisher({ graphBase: process.env.META_GRAPH_BASE, graphVersion: process.env.META_GRAPH_VERSION ?? 'v23.0', userId: process.env.INSTAGRAM_USER_ID, accessToken: process.env.INSTAGRAM_ACCESS_TOKEN });
const service = new GhostwriterService({ store, ai, instagram });
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

async function jsonBody(req) {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function send(res, status, body, type='application/json') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body, null, 2) : body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await readFile(path.join(publicDir, 'index.html'), 'utf8'), 'text/html');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: 'ghostwriter', version: '0.1.0' });
    if (req.method === 'GET' && url.pathname === '/api/identity') return send(res, 200, { identity: await service.getIdentity() });
    if (req.method === 'PUT' && url.pathname === '/api/identity') return send(res, 200, { identity: await service.saveIdentity(await jsonBody(req)) });
    if (req.method === 'GET' && url.pathname === '/api/history') return send(res, 200, { history: await service.history() });
    if (req.method === 'POST' && url.pathname === '/api/generate') return send(res, 201, { draft: await service.generate(await jsonBody(req)) });
    if (req.method === 'POST' && url.pathname === '/api/publish') return send(res, 201, { post: await service.publish(await jsonBody(req)) });
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 400, { error: error.message });
  }
});

server.listen(port, () => console.log(`Ghostwriter listening on http://localhost:${port}`));
