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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(this.env.AI_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.AI_API_KEY}` },
        body: JSON.stringify({
          model: this.env.AI_MODEL,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`AI provider failed: ${res.status} ${await res.text()}`);
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('AI provider returned no JSON content');
      return JSON.parse(text);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class WorkerInstagram {
  constructor(private env: Env) {}

  private async request(path: string, init: RequestInit = {}) {
    const base = `${this.env.META_GRAPH_BASE}/${this.env.META_GRAPH_VERSION}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${base}/${path}`, { ...init, signal: controller.signal });
      if (!res.ok) throw new Error(`Instagram Graph API failed: ${res.status} ${await res.text()}`);
      return res.json<any>();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async graphPost(path: string, body: URLSearchParams) {
    body.set('access_token', this.env.INSTAGRAM_ACCESS_TOKEN);
    return this.request(path, { method: 'POST', body });
  }

  private async waitForContainer(containerId: string) {
    const maxAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const qs = new URLSearchParams({
        fields: 'status_code,status',
        access_token: this.env.INSTAGRAM_ACCESS_TOKEN
      });
      const status = await this.request(`${containerId}?${qs.toString()}`);
      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new Error(`Instagram container ${containerId} failed: ${status.status ?? status.status_code}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
    throw new Error(`Instagram container ${containerId} did not finish processing in time`);
  }

  async publishCarousel({ imageUrls, caption }: { imageUrls: string[]; caption: string }) {
    if (!this.env.INSTAGRAM_USER_ID || !this.env.INSTAGRAM_ACCESS_TOKEN) throw new Error('Instagram credentials are required');
    if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) throw new Error('Instagram carousel requires 2-10 image URLs');

    const children: string[] = [];
    for (const imageUrl of imageUrls) {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== 'https:') throw new Error('Instagram image URLs must use HTTPS');
      const child = await this.graphPost(`${this.env.INSTAGRAM_USER_ID}/media`, new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: 'true'
      }));
      if (!child?.id) throw new Error('Instagram did not return a child container ID');
      await this.waitForContainer(child.id);
      children.push(child.id);
    }

    const carousel = await this.graphPost(`${this.env.INSTAGRAM_USER_ID}/media`, new URLSearchParams({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption
    }));
    if (!carousel?.id) throw new Error('Instagram did not return a carousel container ID');
    await this.waitForContainer(carousel.id);

    const published = await this.graphPost(`${this.env.INSTAGRAM_USER_ID}/media_publish`, new URLSearchParams({ creation_id: carousel.id }));
    if (!published?.id) throw new Error('Instagram did not return a published media ID');
    return published;
  }
}

function service(env: Env) {
  return new GhostwriterService({ store: new D1Store(env.DB), ai: new WorkerAI(env), instagram: new WorkerInstagram(env) });
}

function createServer(env: Env) {
  const server = new McpServer({ name: 'ghostwriter', version: '0.2.1' });

  server.registerTool('get_identity', {
    description: 'Get the creator identity and brand rules Ghostwriter uses.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).getIdentity()) }] }));

  server.registerTool('save_identity', {
    description: 'Save or replace the creator identity and brand rules.',
    inputSchema: { identity: z.record(z.string(), z.unknown()) },
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
    description: 'Publish a saved carousel draft to the connected Instagram account. This is an external write action and must only be called after explicit user approval.',
    inputSchema: { draftId: z.string(), imageUrls: z.array(z.string().url()).min(2).max(10) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, async ({ draftId, imageUrls }) => ({ content: [{ type: 'text', text: JSON.stringify(await service(env).publish({ draftId, imageUrls })) }] }));

  return server;
}

const mcp = (request: Request, env: Env, ctx: ExecutionContext) => createMcpHandler(() => createServer(env))(request, env, ctx);

function hasAdminToken(env: Env) {
  return typeof env.GHOSTWRITER_ADMIN_TOKEN === 'string' && env.GHOSTWRITER_ADMIN_TOKEN.length >= 24;
}

function authorized(request: Request, env: Env) {
  if (!hasAdminToken(env)) return false;
  return request.headers.get('authorization') === `Bearer ${env.GHOSTWRITER_ADMIN_TOKEN}`;
}

function requireAuth(request: Request, env: Env) {
  if (!hasAdminToken(env)) {
    return new Response('Ghostwriter authentication is not configured', { status: 503 });
  }
  if (!authorized(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'ghostwriter-cloudflare' });

    if (url.pathname.startsWith('/assets/')) {
      const key = decodeURIComponent(url.pathname.slice('/assets/'.length));
      if (!key || key.includes('..') || key.startsWith('/')) return new Response('Invalid asset key', { status: 400 });
      if (request.method === 'PUT') {
        const denied = requireAuth(request, env);
        if (denied) return denied;
        const contentLength = Number(request.headers.get('content-length') ?? '0');
        if (contentLength > 20 * 1024 * 1024) return new Response('Asset too large', { status: 413 });
        const contentType = request.headers.get('content-type') ?? 'application/octet-stream';
        if (!contentType.startsWith('image/')) return new Response('Only image assets are allowed', { status: 415 });
        await env.ASSETS.put(key, request.body, { httpMetadata: { contentType } });
        const publicUrl = `${env.PUBLIC_BASE_URL ?? url.origin}/assets/${encodeURIComponent(key)}`;
        await env.DB.prepare('INSERT OR REPLACE INTO assets (id, r2_key, content_type, public_url) VALUES (?, ?, ?, ?)')
          .bind(crypto.randomUUID(), key, contentType, publicUrl).run();
        return Response.json({ key, url: publicUrl });
      }
      if (request.method === 'GET') {
        const object = await env.ASSETS.get(key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        headers.set('x-content-type-options', 'nosniff');
        return new Response(object.body, { headers });
      }
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, PUT' } });
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      return mcp(request, env, ctx);
    }
    return new Response('Ghostwriter on Cloudflare. MCP endpoint: /mcp', { status: 200 });
  }
} satisfies ExportedHandler<Env>;
