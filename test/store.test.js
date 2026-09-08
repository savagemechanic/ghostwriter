import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/core/store.js";
async function store(t) {
  const dir = await mkdtemp(join(tmpdir(), "ghostwriter-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new JsonStore(dir);
}
test("filesystem store rejects path traversal", async (t) => {
  const s = await store(t);
  await assert.rejects(s.read("../../outside"), /Invalid storage key/);
});
test("filesystem concurrent updates preserve both writes", async (t) => {
  const s = await store(t);
  await Promise.all([
    s.update("jobs", [], (a) => [...a, 1]),
    s.update("jobs", [], (a) => [...a, 2]),
  ]);
  assert.deepEqual((await s.read("jobs")).sort(), [1, 2]);
});
test("filesystem publish claim succeeds exactly once", async (t) => {
  const s = await store(t);
  await s.write("draft-d", { id: "d", status: "draft" });
  const claims = await Promise.all([s.claimPublish("d"), s.claimPublish("d")]);
  assert.deepEqual(claims.sort(), [false, true]);
});
