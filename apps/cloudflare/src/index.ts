import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { InstagramPublisher } from "../../../src/adapters/instagram.js";
import { D1Store } from "./store";
import { WorkerAI, R2ImageProvider } from "./providers";
import {
  HttpError,
  readBounded,
  requireAdmin,
  hasAdminToken,
} from "./security";
import { uploadAsset } from "./assets";
import { oauth, authorize } from "./auth";
import { previewHtml } from "./preview";
import { GhostwriterService } from "../../../src/core/service.js";

export interface Env
  extends Pick<Cloudflare.Env, "OAUTH_KV" | "DB" | "ASSETS"> {
  IMAGE_API_URL?: string;
  IMAGE_API_KEY?: string;
  IMAGE_MODEL?: string;
  PUBLISHING_ENABLED?: string;
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

function service(env: Env, origin = env.PUBLIC_BASE_URL ?? "") {
  const instagram = new InstagramPublisher({
    graphBase: env.META_GRAPH_BASE,
    graphVersion: env.META_GRAPH_VERSION,
    userId: env.INSTAGRAM_USER_ID,
    accessToken: env.INSTAGRAM_ACCESS_TOKEN,
  });
  return new GhostwriterService({
    store: new D1Store(env.DB),
    ai: new WorkerAI(env),
    instagram: {
      async publishCarousel(input: { imageUrls: string[]; caption: string }) {
        requirePublishing(env);
        await validatePublishAssets(env, input.imageUrls, origin);
        return instagram.publishCarousel(input);
      },
    },
    imageProvider: new R2ImageProvider(env, origin),
  });
}

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const previewResult = (draft: unknown) => ({
  ...textResult(draft),
  structuredContent: { draft },
});
const authMeta = {
  securitySchemes: [{ type: "oauth2", scopes: ["ghostwriter"] }],
};
const previewMeta = {
  ...authMeta,
  ui: { resourceUri: "ui://ghostwriter/carousel.html" },
  "openai/outputTemplate": "ui://ghostwriter/carousel.html",
};

export function createServer(env: Env, origin: string) {
  const server = new McpServer({ name: "ghostwriter", version: "0.3.1" });
  server.registerTool(
    "get_identity",
    {
      _meta: authMeta,
      description: "Get the creator identity and brand rules Ghostwriter uses.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => textResult(await service(env, origin).getIdentity()),
  );
  server.registerTool(
    "save_identity",
    {
      _meta: authMeta,
      description: "Save or replace the creator identity and brand rules.",
      inputSchema: z.object({ identity: z.record(z.string(), z.unknown()) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ identity }) =>
      textResult(await service(env, origin).saveIdentity(identity)),
  );
  server.registerTool(
    "generate_carousel",
    {
      _meta: previewMeta,
      description:
        "Generate and persist an Instagram carousel draft using the saved identity and learned strategy.",
      inputSchema: z.object({
        objective: z.string().optional(),
        pillar: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => previewResult(await service(env, origin).generate(args)),
  );
  server.registerTool(
    "get_history",
    {
      _meta: authMeta,
      description: "Return Ghostwriter publishing history and stored metrics.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => textResult(await service(env, origin).history()),
  );
  server.registerTool(
    "get_draft",
    {
      _meta: previewMeta,
      description: "Get one saved carousel draft by ID.",
      inputSchema: z.object({ draftId: z.string() }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ draftId }) =>
      previewResult(await service(env, origin).getDraft(draftId)),
  );
  server.registerTool(
    "record_metrics",
    {
      _meta: authMeta,
      description:
        "Record observed Instagram metrics for a media ID already present in Ghostwriter history.",
      inputSchema: z.object({
        mediaId: z.string(),
        metrics: z.record(z.string(), z.number()),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ mediaId, metrics }) =>
      textResult(await service(env, origin).recordMetrics(mediaId, metrics)),
  );
  server.registerTool(
    "get_schedules",
    {
      _meta: authMeta,
      description:
        "Return persisted scheduled publishing jobs and approval state.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => textResult(await service(env, origin).getSchedules()),
  );
  server.registerTool(
    "schedule_carousel",
    {
      _meta: authMeta,
      description:
        "Persist a carousel publishing job for a future time. Manual approval is required by default.",
      inputSchema: z.object({
        draftId: z.string(),
        runAt: z.string(),
        imageUrls: z.array(z.string().url()).min(2).max(10),
        approvalRequired: z.literal(true).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ draftId, runAt, imageUrls, approvalRequired }) =>
      textResult(
        await service(env, origin).schedule({
          draftId,
          runAt,
          imageUrls,
          approvalRequired: approvalRequired ?? true,
        }),
      ),
  );
  server.registerTool(
    "approve_schedule",
    {
      _meta: authMeta,
      description:
        "Explicitly approve one scheduled carousel for automatic publication when due.",
      inputSchema: z.object({ scheduleId: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ scheduleId }) => {
      requirePublishing(env);
      return textResult(await service(env, origin).approveSchedule(scheduleId));
    },
  );
  server.registerTool(
    "publish_carousel",
    {
      _meta: authMeta,
      description:
        "Publish a saved carousel draft to the connected Instagram account. This is an external write action and must only be called after explicit user approval.",
      inputSchema: z.object({
        draftId: z.string(),
        imageUrls: z.array(z.string().url()).min(2).max(10),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ draftId, imageUrls }) => {
      requirePublishing(env);
      await validatePublishAssets(env, imageUrls, origin);
      return textResult(
        await service(env, origin).publish({ draftId, imageUrls }),
      );
    },
  );
  server.registerTool(
    "generate_images",
    {
      description:
        "Generate finished JPEG slides for a saved draft using the configured image provider and store them in R2. Incurs provider usage. Does not publish.",
      inputSchema: z.object({ draftId: z.string().min(1) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: previewMeta,
    },
    async ({ draftId }) =>
      previewResult(await service(env, origin).generateImages({ draftId })),
  );
  server.registerResource(
    "Carousel preview",
    "ui://ghostwriter/carousel.html",
    { mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [
        {
          uri: "ui://ghostwriter/carousel.html",
          mimeType: "text/html;profile=mcp-app",
          text: previewHtml,
          _meta: {
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: [origin],
            },
            ui: { csp: { resourceDomains: [origin] } },
          },
        },
      ],
    }),
  );
  return server;
}

function requirePublishing(env: Env) {
  if (env.PUBLISHING_ENABLED !== "true")
    throw new Error(
      "Publishing is disabled; the owner must enable it after verification",
    );
}
async function validatePublishAssets(env: Env, urls: string[], origin: string) {
  for (const value of urls) {
    const u = new URL(value);
    if (
      u.origin !== origin ||
      !u.pathname.startsWith("/assets/") ||
      u.search ||
      u.hash
    )
      throw new Error("Publishing requires this Worker’s stored JPEG assets");
    const object = await env.ASSETS.head(
      decodeURIComponent(u.pathname.slice(8)),
    );
    if (!object || object.httpMetadata?.contentType !== "image/jpeg")
      throw new Error("Stored JPEG asset not found");
  }
}
export const apiHandler: Required<Pick<ExportedHandler<Env>, "fetch">> = {
  async fetch(request, env, ctx) {
    if ((ctx.props as { userId?: string })?.userId !== "owner")
      throw new HttpError(403, "Owner authorization required");
    return createMcpHandler(
      () => createServer(env, new URL(request.url).origin),
      { corsOptions: false },
    )(request, env, ctx);
  },
};
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        await env.DB.prepare("SELECT 1").first();
        return Response.json({
          ok: true,
          service: "ghostwriter-cloudflare",
          publishingEnabled: env.PUBLISHING_ENABLED === "true",
        });
      }
      if (url.pathname.startsWith("/assets/")) {
        const key = decodeURIComponent(url.pathname.slice(8));
        if (
          !/^[a-zA-Z0-9_/-]+\.jpg$/.test(key) ||
          key.includes("..") ||
          key.startsWith("/") ||
          key.length > 200
        )
          throw new HttpError(400, "Invalid asset key");
        if (request.method === "GET" || request.method === "HEAD") {
          const object = await env.ASSETS.get(key);
          if (!object || object.httpMetadata?.contentType !== "image/jpeg")
            throw new HttpError(404, "Not found");
          return new Response(request.method === "HEAD" ? null : object.body, {
            headers: {
              "content-type": "image/jpeg",
              "cache-control": "public,max-age=86400,immutable",
              "x-content-type-options": "nosniff",
              etag: object.httpEtag,
            },
          });
        }
        if (request.method !== "PUT")
          throw new HttpError(405, "Method not allowed");
        await requireAdmin(request, env);
        return await uploadAsset(request, env, key, url.origin);
      }
      if (!hasAdminToken(env))
        throw new HttpError(503, "Authentication not configured");
      if (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL !== url.origin)
        throw new HttpError(400, "Invalid host");
      if (
        request.headers.get("origin") &&
        request.headers.get("origin") !== url.origin
      )
        throw new HttpError(403, "Invalid origin");
      const window = Math.floor(Date.now() / 60000);
      const rateKey = request.headers.get("cf-connecting-ip") ?? "local";
      const rate = await env.DB.prepare(
        "INSERT INTO rate_limits(key,window,requests) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET requests=CASE WHEN window=excluded.window THEN requests+1 ELSE 1 END,window=excluded.window RETURNING requests",
      )
        .bind(rateKey, window)
        .first<{ requests: number }>();
      if ((rate?.requests ?? 0) > 60)
        throw new HttpError(429, "Rate limit exceeded");
      if (request.body) {
        const bytes = await readBounded(request.body, 256 * 1024);
        request = new Request(request, { body: new Uint8Array(bytes).buffer });
      }
      const defaultHandler: Required<Pick<ExportedHandler<Env>, "fetch">> = {
        async fetch(req, bindings) {
          if (new URL(req.url).pathname === "/authorize")
            return authorize(
              req,
              bindings as Env & {
                OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
              },
            );
          return new Response("Not found", { status: 404 });
        },
      };
      return await oauth(env, url.origin, apiHandler, defaultHandler).fetch(
        request,
        env,
        ctx,
      );
    } catch (error) {
      if (error instanceof AuthorizationError)
        return Response.json(
          { error: error.code },
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      if (error instanceof HttpError)
        return Response.json(
          { error: error.message },
          { status: error.status, headers: { "cache-control": "no-store" } },
        );
      console.error(
        JSON.stringify({
          event: "request_failed",
          errorType: error instanceof Error ? error.name : "unknown",
        }),
      );
      return Response.json({ error: "Request failed" }, { status: 500 });
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        await env.DB.prepare("DELETE FROM oauth_pending WHERE expires_at<?")
          .bind(Date.now())
          .run();
        await env.DB.prepare("DELETE FROM rate_limits WHERE window<?")
          .bind(Math.floor(Date.now() / 60000) - 5)
          .run();
        if (env.PUBLISHING_ENABLED !== "true") return;
        const svc = service(env);
        await svc.runDueSchedules(new Date());
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
