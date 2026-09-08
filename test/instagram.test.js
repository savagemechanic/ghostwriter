import test from "node:test";
import assert from "node:assert/strict";
import { InstagramPublisher } from "../src/adapters/instagram.js";
const urls = ["https://images.example/a.jpg", "https://images.example/b.jpg"];
function publisher(replies) {
  const calls = [];
  const delays = [];
  const api = new InstagramPublisher({
    graphVersion: "v23.0",
    userId: "1",
    accessToken: "test-only",
    attempts: 3,
    delayMs: 1,
    sleepImpl: async (ms) => delays.push(ms),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), ...options });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return Response.json(reply ?? {}, { status: reply?.httpStatus ?? 200 });
    },
  });
  return { api, calls, delays };
}
test("Instagram polls each image and parent before a single publish", async () => {
  const { api, calls, delays } = publisher([
    { id: "10" },
    { status_code: "IN_PROGRESS" },
    { status_code: "FINISHED" },
    { id: "11" },
    { status_code: "FINISHED" },
    { id: "12" },
    { status_code: "IN_PROGRESS" },
    { status_code: "FINISHED" },
    { id: "13" },
  ]);
  assert.equal(
    (await api.publishCarousel({ imageUrls: urls, caption: "hello" })).id,
    "13",
  );
  assert.equal(calls.filter((c) => c.url.includes("media_publish")).length, 1);
  assert.equal(calls[5].body.get("children"), "10,11");
  assert.equal(delays.length, 2);
  assert.ok(
    calls.every(
      (c) =>
        c.headers.authorization === "Bearer test-only" &&
        !c.url.includes("test-only"),
    ),
  );
});
for (const status of ["ERROR", "EXPIRED", "PUBLISHED"])
  test(`Instagram stops on ${status}`, async () => {
    const { api, calls } = publisher([{ id: "10" }, { status_code: status }]);
    await assert.rejects(
      api.publishCarousel({ imageUrls: urls, caption: "" }),
      new RegExp(status),
    );
    assert.equal(calls.length, 2);
  });
test("Instagram processing has a finite polling timeout", async () => {
  const { api, calls } = publisher([
    { id: "10" },
    ...Array(3).fill({ status_code: "IN_PROGRESS" }),
  ]);
  await assert.rejects(
    api.publishCarousel({ imageUrls: urls, caption: "" }),
    /Timed out/,
  );
  assert.equal(calls.length, 4);
});
test("Instagram never replays ambiguous POSTs", async () => {
  const { api, calls } = publisher([
    new DOMException("timeout", "TimeoutError"),
  ]);
  await assert.rejects(
    api.publishCarousel({ imageUrls: urls, caption: "" }),
    /timeout/,
  );
  assert.equal(calls.length, 1);
});
test("Instagram retries temporary GET failures within its limit", async () => {
  const { api, calls } = publisher([
    { httpStatus: 503 },
    { status_code: "FINISHED" },
  ]);
  await api.waitUntilReady("10");
  assert.equal(calls.length, 2);
});
