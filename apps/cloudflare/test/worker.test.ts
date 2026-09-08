import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, expect, test } from "vitest";
import worker, { type Env } from "../src/index";
import { D1Store } from "../src/store";
import { GhostwriterService } from "../../../src/core/service.js";
import migration1 from "../migrations/0001_init.sql?raw";
import migration2 from "../migrations/0002_security.sql?raw";
const bindings = env as unknown as Env;
const origin = "https://ghostwriter.example";
const key = "test-owner-key-that-is-never-real";
async function request(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(origin + path, init),
    { ...bindings, ...overrides },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}
beforeAll(async () => {
  for (const sql of [migration1, migration2])
    for (const statement of sql.split(";").filter((s) => s.trim()))
      await bindings.DB.prepare(statement).run();
});
beforeEach(async () => {
  await bindings.DB.batch(
    [
      "DELETE FROM kv",
      "DELETE FROM rate_limits",
      "DELETE FROM oauth_pending",
      "DELETE FROM assets",
    ].map((s) => bindings.DB.prepare(s)),
  );
});
test("health checks D1, publishing disabled", async () => {
  expect(await (await request("/health")).json()).toMatchObject({
    ok: true,
    publishingEnabled: false,
  });
});
test("missing admin token fails closed", async () => {
  expect(
    (
      await request(
        "/mcp",
        { method: "POST" },
        { GHOSTWRITER_ADMIN_TOKEN: undefined },
      )
    ).status,
  ).toBe(503);
});
test("unauthorized MCP advertises OAuth and rejects owner bearer key", async () => {
  const res = await request("/mcp", { method: "POST" });
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toContain("resource_metadata");
  expect(
    (
      await request("/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
      })
    ).status,
  ).toBe(401);
});
test("R2 rejects unauthorized PUT but permits public JPEG GET", async () => {
  expect(
    (await request("/assets/a.jpg", { method: "PUT", body: "x" })).status,
  ).toBe(401);
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const put = await request("/assets/a.jpg", {
    method: "PUT",
    headers: { authorization: `Bearer ${key}`, "content-type": "image/jpeg" },
    body: bytes,
  });
  expect(put.status).toBe(200);
  const get = await request("/assets/a.jpg");
  expect(get.status).toBe(200);
  expect(get.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
  expect(
    (
      await request("/assets/a.jpg", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "image/jpeg",
        },
        body: bytes,
      })
    ).status,
  ).toBe(409);
});
test("R2 rejects SVG, disguised non-JPEG and oversized streamed body", async () => {
  for (const [type, body, status] of [
    ["image/svg+xml", "<svg/>", 415],
    ["image/jpeg", "<html/>", 415],
    ["image/jpeg", new Uint8Array(8 * 1024 * 1024 + 1), 413],
  ] as const) {
    expect(
      (
        await request("/assets/invalid.jpg", {
          method: "PUT",
          headers: { authorization: `Bearer ${key}`, "content-type": type },
          body,
        })
      ).status,
    ).toBe(status);
  }
});
async function obtainToken() {
  const registered = await request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test client",
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registered.status).toBe(201);
  const client: any = await registered.json();
  const verifier = "a".repeat(64);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const challenge = btoa(String.fromCharCode(...hash))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: "ghostwriter",
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: origin + "/mcp",
  });
  const consent = await request("/authorize?" + query);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  const nonce = html.match(/name="nonce" value="([^"]+)"/)![1];
  const cookie = consent.headers.get("set-cookie")!.split(";")[0];
  const body = new URLSearchParams({ nonce, owner_key: key }).toString();
  expect(
    (
      await request("/authorize", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      })
    ).status,
  ).toBe(403);
  const approved = await request("/authorize", {
    method: "POST",
    headers: {
      origin,
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  expect(approved.status).toBe(302);
  const callback = new URL(approved.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe("test-state");
  const token = await request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      resource: origin + "/mcp",
    }),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as any).access_token;
}
async function rpc(token: string, method: string, params: unknown = {}) {
  const res = await request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.status).toBe(200);
  const raw = await res.text();
  return JSON.parse(
    raw.startsWith("event:") || raw.startsWith("data:")
      ? raw
          .split("\n")
          .find((l) => l.startsWith("data:"))!
          .slice(5)
      : raw,
  );
}
test("OAuth DCR + S256 consent issues real token for MCP initialize and tools/list", async () => {
  const metadata = await (
    await request("/.well-known/oauth-protected-resource")
  ).json();
  expect(metadata).toMatchObject({ resource: origin + "/mcp" });
  const token = await obtainToken();
  expect(typeof token).toBe("string");
  const init = await rpc(token, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "runtime-test", version: "1" },
  });
  expect(init.result.serverInfo.name).toBe("ghostwriter");
  const list = await rpc(token, "tools/list");
  expect(list.error).toBeUndefined();
  expect(list.result.tools.map((t: any) => t.name)).toEqual(
    expect.arrayContaining([
      "generate_images",
      "schedule_carousel",
      "record_metrics",
      "publish_carousel",
    ]),
  );
  expect(list.result.tools).toHaveLength(11);
  const publish = await rpc(token, "tools/call", {
    name: "publish_carousel",
    arguments: {
      draftId: "x",
      imageUrls: ["https://a.example/a.jpg", "https://a.example/b.jpg"],
    },
  });
  expect(publish.result.isError).toBe(true);
});
test("D1 atomic claim prevents simultaneous publication and duplicate history", async () => {
  const store = new D1Store(bindings.DB);
  await store.write("draft-race", { id: "race", status: "draft", caption: "" });
  let calls = 0;
  const service = new GhostwriterService({
    store,
    ai: {},
    instagram: {
      async publishCarousel() {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return { id: "123" };
      },
    },
  });
  const input = {
    draftId: "race",
    imageUrls: ["https://a/a.jpg", "https://a/b.jpg"],
  };
  await Promise.allSettled([service.publish(input), service.publish(input)]);
  await service.publish(input);
  expect(calls).toBe(1);
  expect(await service.history()).toHaveLength(1);
});
test("failed publication persists and refuses ambiguous retries", async () => {
  const store = new D1Store(bindings.DB);
  await store.write("draft-f", { id: "f", status: "draft", caption: "" });
  let calls = 0;
  const service = new GhostwriterService({
    store,
    ai: {},
    instagram: {
      async publishCarousel() {
        calls++;
        throw new Error("timeout");
      },
    },
  });
  const input = {
    draftId: "f",
    imageUrls: ["https://a/a.jpg", "https://a/b.jpg"],
  };
  await expect(service.publish(input)).rejects.toThrow("timeout");
  expect(await service.getDraft("f")).toMatchObject({
    status: "publish_failed",
  });
  await expect(service.publish(input)).rejects.toThrow("reconcile");
  expect(calls).toBe(1);
});
test("D1 schedules wait for approval and concurrent runners publish once", async () => {
  const store = new D1Store(bindings.DB);
  await store.write("draft-s", { id: "s", status: "draft", caption: "" });
  let calls = 0;
  const service = new GhostwriterService({
    store,
    ai: {},
    instagram: {
      async publishCarousel() {
        calls++;
        return { id: "456" };
      },
    },
  });
  const job = await service.schedule({
    draftId: "s",
    runAt: "2020-01-01",
    imageUrls: ["https://a/a.jpg", "https://a/b.jpg"],
  });
  expect(job.approved).toBe(false);
  expect(await service.runDueSchedules()).toEqual([]);
  await service.approveSchedule(job.id);
  await Promise.all([service.runDueSchedules(), service.runDueSchedules()]);
  expect(calls).toBe(1);
  expect((await service.getSchedules())[0].status).toBe("completed");
});

test("concrete image provider stores returned JPEG bytes in R2", async () => {
  const { R2ImageProvider } = await import("../src/providers");
  const { vi } = await import("vitest");
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const mocked = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({
        data: [{ b64_json: btoa(String.fromCharCode(...bytes)) }],
      }),
    );
  try {
    const provider = new R2ImageProvider(
      {
        ...bindings,
        IMAGE_API_URL: "https://api.openai.com/v1/images/generations",
        IMAGE_API_KEY: "test-only-image-key",
        IMAGE_MODEL: "test-model",
      },
      origin,
    );
    const result = await provider.generateImage({
      prompt: "A mountain",
      identity: { name: "Example" },
      draft: { id: "d", slides: [{ copy: "Hello" }] },
      slideIndex: 0,
    });
    expect(result.url).toContain(origin + "/assets/");
    expect(
      (await bindings.ASSETS.head(result.key))?.httpMetadata?.contentType,
    ).toBe("image/jpeg");
    const options = mocked.mock.calls[0][1]!;
    expect(JSON.parse(options.body as string)).toMatchObject({
      model: "test-model",
      output_format: "jpeg",
      n: 1,
    });
    expect(
      await (await request(new URL(result.url).pathname)).arrayBuffer(),
    ).toEqual(bytes.buffer);
  } finally {
    mocked.mockRestore();
  }
});
test("published draft repairs missing history without any Instagram request", async () => {
  const store = new D1Store(bindings.DB);
  await store.write("draft-done", {
    id: "done",
    status: "published",
    mediaId: "789",
    publishedAt: "2026-01-01",
  });
  const service = new GhostwriterService({
    store,
    ai: {},
    instagram: {
      publishCarousel() {
        throw new Error("Must not publish");
      },
    },
  });
  await service.publish({ draftId: "done" });
  await service.publish({ draftId: "done" });
  expect(await service.history()).toHaveLength(1);
});
test("Cron never publishes while the owner has disabled publishing", async () => {
  const store = new D1Store(bindings.DB);
  await store.write("schedules", [
    { id: "blocked", status: "scheduled", approved: true, runAt: "2020-01-01" },
  ]);
  const ctx = createExecutionContext();
  await worker.scheduled({} as ScheduledController, bindings, ctx);
  await waitOnExecutionContext(ctx);
  expect(await store.read("schedules")).toEqual([
    { id: "blocked", status: "scheduled", approved: true, runAt: "2020-01-01" },
  ]);
});

test("OAuth refuses authorization without S256 PKCE", async () => {
  const registration = await request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  const client: any = await registration.json();
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: "ghostwriter",
    code_challenge: "a".repeat(43),
    code_challenge_method: "plain",
  });
  expect((await request("/authorize?" + params)).status).toBe(400);
});
