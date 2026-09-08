import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { JsonStore } from '../../../src/core/store.js';
import { GhostwriterService } from '../../../src/core/service.js';
import { OpenAICompatibleTextProvider } from '../../../src/adapters/ai.js';
import { InstagramPublisher } from '../../../src/adapters/instagram.js';

const VERSION = '0.1.0';
const PORT = Number(process.env.CHATGPT_APP_PORT ?? process.env.PORT ?? 8788);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_DIR, '..', '..');
const DATA_DIR = path.resolve(process.env.GHOSTWRITER_DATA_DIR ?? path.join(REPO_ROOT, 'data'));
const PREVIEW_URI = 'ui://ghostwriter/carousel-preview-v1.html';
const previewHtml = fs.readFileSync(path.join(APP_DIR, 'assets', 'carousel-preview.html'), 'utf8');

function makeService() {
  const store = new JsonStore(DATA_DIR);
  const ai = new OpenAICompatibleTextProvider({
    apiUrl: process.env.AI_API_URL,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
  });
  const instagram = new InstagramPublisher({
    graphBase: process.env.META_GRAPH_BASE,
    graphVersion: process.env.META_GRAPH_VERSION ?? 'v23.0',
    userId: process.env.INSTAGRAM_USER_ID,
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
  });
  return new GhostwriterService({ store, ai, instagram });
}

const service = makeService();

function textResult(text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function createMcpServer() {
  const server = new McpServer({ name: 'ghostwriter', version: VERSION });

  registerAppTool(server, 'get_identity', {
    title: 'Get Ghostwriter Identity',
    description: 'Read the creator/brand identity Ghostwriter uses for social content generation.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const identity = await service.getIdentity();
    return textResult(identity ? `Loaded Ghostwriter identity for ${identity.name}.` : 'No Ghostwriter identity has been configured yet.', { identity });
  });

  registerAppTool(server, 'save_identity', {
    title: 'Save Ghostwriter Identity',
    description: 'Create or replace the creator identity, visual rules, voice, audience, content pillars, CTA rules, and hashtag limit used by Ghostwriter.',
    inputSchema: {
      name: z.string().min(1),
      visual: z.object({
        appearance: z.array(z.string()).optional(),
        wardrobeRules: z.array(z.string()).optional(),
        signatureDetails: z.array(z.string()).optional(),
        forbiddenInconsistencies: z.array(z.string()).optional(),
      }).optional(),
      brand: z.object({
        voice: z.array(z.string()).optional(),
        audience: z.array(z.string()).optional(),
        contentPillars: z.array(z.string()).min(1),
        ctaRules: z.array(z.string()).optional(),
        maxHashtags: z.number().int().min(0).max(30).optional(),
      }),
      creative: z.object({
        cinematography: z.array(z.string()).optional(),
        compositionRules: z.array(z.string()).optional(),
        typographyRules: z.array(z.string()).optional(),
      }).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    const identity = await service.saveIdentity(input);
    return textResult(`Saved Ghostwriter identity for ${identity.name}.`, { identity });
  });

  registerAppTool(server, 'generate_carousel', {
    title: 'Generate Instagram Carousel',
    description: 'Generate and persist a new Instagram carousel draft from the saved Ghostwriter identity and strategy. Use when the user asks Ghostwriter to create, draft, or prepare a carousel.',
    inputSchema: {
      objective: z.string().default('engagement').describe('Primary objective, e.g. engagement, saves, shares, follows, education, conversion.'),
      pillar: z.string().optional().describe('Optional content pillar. If omitted, Ghostwriter chooses using performance-aware strategy weights.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: PREVIEW_URI },
      'openai/outputTemplate': PREVIEW_URI,
      'openai/toolInvocation/invoking': 'Ghostwriter is drafting the carousel…',
      'openai/toolInvocation/invoked': 'Carousel draft ready',
    },
  }, async ({ objective, pillar }) => {
    const draft = await service.generate({ objective, pillar });
    return textResult(
      `Created carousel draft ${draft.id} with ${draft.slides.length} slides. Review it before publishing.`,
      { draft }
    );
  });

  registerAppTool(server, 'get_draft', {
    title: 'Get Carousel Draft',
    description: 'Read one previously generated Ghostwriter carousel draft by ID.',
    inputSchema: { draftId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: PREVIEW_URI }, 'openai/outputTemplate': PREVIEW_URI },
  }, async ({ draftId }) => {
    const draft = await service.getDraft(draftId);
    if (!draft) return textResult(`No draft found with ID ${draftId}.`, { draft: null });
    return textResult(`Loaded carousel draft ${draftId}.`, { draft });
  });

  registerAppTool(server, 'get_history', {
    title: 'Get Publishing History',
    description: 'Read Ghostwriter publishing history and stored post metrics used by the strategy engine.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const history = await service.history();
    return textResult(`Ghostwriter has ${history.length} history entr${history.length === 1 ? 'y' : 'ies'}.`, { history });
  });

  registerAppTool(server, 'record_metrics', {
    title: 'Record Post Metrics',
    description: 'Store performance metrics for a published Ghostwriter post so future pillar selection can learn from results.',
    inputSchema: {
      mediaId: z.string().min(1),
      metrics: z.record(z.number().nonnegative()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ mediaId, metrics }) => {
    const entry = await service.recordMetrics(mediaId, metrics);
    return textResult(`Updated metrics for Instagram media ${mediaId}.`, { entry });
  });

  registerAppTool(server, 'publish_carousel', {
    title: 'Publish Instagram Carousel',
    description: 'Publish an existing Ghostwriter draft to the configured Instagram professional account using the Meta Graph API. Requires 2-10 publicly reachable image URLs. This is an external write action and creates a real Instagram post.',
    inputSchema: {
      draftId: z.string().min(1),
      imageUrls: z.array(z.string().url()).min(2).max(10),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      'openai/toolInvocation/invoking': 'Publishing carousel to Instagram…',
      'openai/toolInvocation/invoked': 'Instagram carousel published',
    },
  }, async ({ draftId, imageUrls }) => {
    const post = await service.publish({ draftId, imageUrls });
    return textResult(`Published Ghostwriter draft ${draftId} to Instagram as media ${post.mediaId}.`, { post });
  });

  registerAppResource(server, 'Ghostwriter Carousel Preview', PREVIEW_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    description: 'Compact preview of a generated Ghostwriter Instagram carousel.',
  }, async () => ({
    contents: [{
      uri: PREVIEW_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: previewHtml,
      _meta: {
        'openai/widgetDescription': 'Shows the generated Ghostwriter carousel title, pillar, hook, slide copy, and draft status.',
      },
    }],
  }));

  return server;
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, name: 'ghostwriter-chatgpt-app', version: VERSION }));
app.all('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Ghostwriter MCP error:', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Ghostwriter ChatGPT app listening on http://localhost:${PORT}/mcp`);
});
