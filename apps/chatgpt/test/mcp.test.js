import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const token = "test-only-node-owner-key-32-characters";
async function start(t, configured = true) {
  const dir = await mkdtemp(join(tmpdir(), "ghostwriter-test-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    env: {
      ...process.env,
      CHATGPT_APP_PORT: "0",
      GHOSTWRITER_DATA_DIR: dir,
      GHOSTWRITER_ADMIN_TOKEN: configured ? token : "",
      PUBLISHING_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  for (let i = 0; i < 100; i++) {
    const match = output.match(/localhost:(\d+)\/mcp/);
    if (match) return "http://localhost:" + match[1];
    if (child.exitCode !== null) throw new Error("Server exited");
    await delay(50);
  }
  throw new Error("Server startup timed out");
}
test("Node MCP initialize and tools/list work through authenticated HTTP", async (t) => {
  const base = await start(t);
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal((await fetch(base + "/mcp", { method: "POST" })).status, 401);
  async function rpc(method, params = {}) {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    return JSON.parse(
      raw.startsWith("{")
        ? raw
        : raw
            .split("\n")
            .find((l) => l.startsWith("data:"))
            .slice(5),
    );
  }
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "ghostwriter");
  const list = await rpc("tools/list");
  assert.ok(list.result.tools.some((t) => t.name === "publish_carousel"));
  assert.equal(list.result.tools.length, 7);
});
test("Node MCP fails closed without an owner key", async (t) => {
  const base = await start(t, false);
  assert.equal((await fetch(base + "/mcp", { method: "POST" })).status, 503);
});
