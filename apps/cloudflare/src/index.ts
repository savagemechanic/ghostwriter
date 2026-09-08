import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { GhostwriterService } from '../../../src/core/service.js';

interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  AI_API_URL: string;
  AI_API_KEY: string;
  AI_MODEL: string;
  META_GRAPH_BASE: string;
  META_GRAPH_VERSION: string;
  INSTAGRAM_USER_ID: string;
  INSTAGRAM_ACCESS_TOKEN: string;
  GHOSTWRITER_ADMIN_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
}

class D1Store {
  constructor(private db: D1Database) {}
  async read<T>(key: string, fallback: T | null = null): Promise<T | null> {
    const row = await this.db.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first<{ value: string }>();
    return row ? JSON.parse(row.value) as T : fallback;
  }
  async write<T>(key: string, value: T): Promise<T> {
    await this.db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).bind(key, JSON.stringify(value)).run();
    return value;
  }
}

class WorkerAI {
  constructor(private env: Env) {}
  async generateJson(system: string, prompt: string) {
    if (!this.env.AI_API_KEY || !this.env.AI_MODEL) throw new Error('AI_API_KEY and AI_MODEL are required');
    const res = await fetch(this.env.AI_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.AI_API_KEY}` },
      body: JSON.stringify({
        model: this.env.AI_MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`AI provider failed: ${res.status} ${await res.text()}`);
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('AI provider returned no JSON content');
    return JSON.parse(text);
  }
}

class WorkerInstagram {
  constructor(private env: Env) {}
  private async graph(path: string, body: URLSearchParams) {
    body.set('access_token', this.env.INSTAGRAM_ACCESS_TOKEN);
    const base = `${this.env.META_GRAPH_BASE}/${this.env.META_GRAPH_VERSION}`;
    const res = await fetch(`${base}/${path}`, { method: 'POST', body });
    if (!res.ok) throw new Error(`Instagram Graph API failed: ${res.status} ${await res.text()}`);
    return res.json<any>();
  }
  async publishCarousel({ imageUrls, caption }: { imageUrls: string[]; caption: string }) {
    if (!this.env.INSTAGRAM_USER_ID || !this.env.INSTAGRAM_ACCESS_TOKEN) throw new Error('Instagram credentials are required');
    if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) throw new Error('Instagram carousel requires 2-10 image URLs');
    const children: string[] = [];
    for (const imageUrl of imageUrls) {
      const p = new URLSearchParams({ image_url: imageUrl, is_carousel_item: 'true' });
      const child = await this.graph(`${this.env.INSTAGRAM_USER_ID}/media`, p);
      children.push(child.id);
    }
    const carousel = await this.graph(`${this.env.INSTAGRAM_USER_ID}/media`, new URLSearchParams({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption
    }));
    return this.graph(`${this.env.INSTAGRAM_USER_ID}/media_publish`, new URLSearchParams({ creation_id: carousel.id }));
  }
}

function service(env: Env) {
  return new GhostwriterService({ store: new D1Store(env.DB), ai: new WorkerAI(env), instagram: new WorkerInstagram(env) });
}

function createServer(env: Env) {
  const server = new McpServer({ name: 'ghostwriter', version: '0.2.0' });

  server.registerTool('get_identity', {
    description: 'Get the creator identity and brand rules Ghostwriter uses.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).getIdentity()) }] }));

  server.registerTool('save_identity', {
    description: 'Save or replace the creator identity and brand rules.',
    inputSchema: { identity: z.record(z.any()) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ identity }) => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).saveIdentity(identity)) }] }));

  server.registerTool('generate_carousel', {
    description: 'Generate and persist an Instagram carousel draft using the saved identity and learned strategy.',
    inputSchema: { objective: z.string().optional(), pillar: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).generate(args)) }] }));

  server.registerTool('get_history', {
    description: 'Return Ghostwriter publishing history and stored metrics.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).history()) }] }));

  server.registerTool('get_draft', {
    description: 'Get one saved carousel draft by ID.',
    inputSchema: { draftId: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ draftId }) => {
    const draft = await new D1Store(env.DB).read(`draft-${draftId}`);
    return { content: [{ type: 'text', text: JSON.stringify(draft) }] };
  });

  server.registerTool('publish_carousel', {
    description: 'Publish a saved carousel draft to the connected Instagram account. This is an external write action.',
    inputSchema: { draftId: z.string(), imageUrls: z.array(z.string().url()).min(2).max(10) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, async ({ draftId, imageUrls }) => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).publish({ draftId, imageUrls })) }] }));

  return server;
}

const mcp = (request: Request, env: Env, ctx: ExecutionContext) => createMcpHandler(() => createServer(env))(request, env, ctx);

function authorized(request: Request, env: Env) {
  if (!env.GHOSTWRITER_ADMIN_TOKEN) return true;
  return request.headers.get('authorization') === `Bearer ${env.GHOSTWRITER_ADMIN_TOKEN}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'ghostwriter-cloudflare' });

    if (url.pathname.startsWith('/assets/')) {
      const key = decodeURIComponent(url.pathname.slice('/assets/'.length));
      if (!key) return new Response('Missing asset key', { status: 400 });
      if (request.method === 'PUT') {
        if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 });
        await env.ASSETS.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' } });
        const publicUrl = `${env.PUBLIC_BASE_URL ?? url.origin}/assets/${encodeURIComponent(key)}`;
        await env.DB.prepare('INSERT OR REPLACE INTO assets (id, r2_key, content_type, public_url) VALUES (?, ?, ?, ?)')
          .bind(crypto.randomUUID(), key, request.headers.get('content-type'), publicUrl).run();
        return Response.json({ key, url: publicUrl });
      }
      if (request.method === 'GET') {
        const object = await env.ASSETS.get(key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(object.body, { headers });
      }
      return new Response('Method not allowed', { status: 405 });
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return mcp(request, env, ctx);
    return new Response('Ghostwriter on Cloudflare. MCP endpoint: /mcp', { status: 200 });
  }
} satisfies ExportedHandler<Env>;
