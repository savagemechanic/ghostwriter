const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class InstagramPublisher {
  constructor({
    graphBase = "https://graph.facebook.com",
    graphVersion,
    userId,
    accessToken,
    fetchImpl = fetch,
    sleepImpl = sleep,
    timeoutMs = 30000,
    attempts = 5,
    delayMs = 60000,
    totalTimeoutMs = 600000,
  }) {
    if (
      !["https://graph.facebook.com", "https://graph.instagram.com"].includes(
        graphBase,
      )
    )
      throw new Error("Unsupported Meta Graph origin");
    if (!/^v\d+\.0$/.test(graphVersion ?? ""))
      throw new Error("A Meta Graph version is required");
    this.base = `${graphBase}/${graphVersion}`;
    Object.assign(this, {
      userId,
      accessToken,
      fetchImpl,
      sleepImpl,
      timeoutMs,
      attempts,
      delayMs,
      totalTimeoutMs,
    });
  }
  async request(path, params, method = "GET", deadline = Infinity) {
    if (!this.userId || !this.accessToken)
      throw new Error("Instagram publisher is not configured");
    const url = new URL(`${this.base}/${path}`);
    const body = new URLSearchParams(params);
    if (method === "GET") url.search = body.toString();
    // GET retries are safe. Never replay container creation or media_publish after ambiguity.
    for (let attempt = 0; ; attempt++) {
      try {
        if (Date.now() >= deadline)
          throw new Error("Instagram operation deadline exceeded");
        const res = await this.fetchImpl(url, {
          method,
          headers: { authorization: `Bearer ${this.accessToken}` },
          ...(method === "POST" ? { body } : {}),
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(this.timeoutMs, deadline - Date.now())),
          ),
          redirect: "error",
        });
        if (
          method === "GET" &&
          (res.status === 429 || res.status >= 500) &&
          attempt < 2
        ) {
          await res.body?.cancel();
          await this.sleepImpl(1000 * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`Instagram request failed (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (json.error)
          throw new Error(
            `Instagram API error ${Number(json.error.code) || "unknown"}`,
          );
        return json;
      } catch (error) {
        if (
          method === "GET" &&
          ["TimeoutError", "AbortError", "TypeError"].includes(error.name) &&
          attempt < 2
        ) {
          await this.sleepImpl(1000 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
  }
  async waitUntilReady(containerId, deadline = Infinity) {
    if (!/^\d+$/.test(containerId ?? ""))
      throw new Error("Invalid Instagram container ID");
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      const status = await this.request(
        containerId,
        { fields: "status_code" },
        "GET",
        deadline,
      );
      if (status.status_code === "FINISHED") return;
      if (["ERROR", "EXPIRED", "PUBLISHED"].includes(status.status_code))
        throw new Error(`Instagram container ${status.status_code}`);
      if (attempt + 1 < this.attempts) await this.sleepImpl(this.delayMs);
    }
    throw new Error("Timed out waiting for Instagram media container");
  }
  async publishCarousel({ imageUrls, caption }) {
    if (!/^\d+$/.test(this.userId ?? ""))
      throw new Error("Invalid Instagram user ID");
    if (
      !Array.isArray(imageUrls) ||
      imageUrls.length < 2 ||
      imageUrls.length > 10
    )
      throw new Error("Instagram carousel requires 2-10 images");
    if (typeof caption !== "string" || caption.length > 2200)
      throw new Error("Instagram caption must be at most 2200 characters");
    for (const imageUrl of imageUrls) {
      const u = new URL(imageUrl);
      if (u.protocol !== "https:" || u.username || u.password)
        throw new Error("Instagram images require public HTTPS URLs");
    }
    const deadline = Date.now() + this.totalTimeoutMs;
    const children = [];
    for (const imageUrl of imageUrls) {
      const item = await this.request(
        `${this.userId}/media`,
        { image_url: imageUrl, is_carousel_item: "true" },
        "POST",
        deadline,
      );
      await this.waitUntilReady(item.id, deadline);
      children.push(item.id);
    }
    const parent = await this.request(
      `${this.userId}/media`,
      { media_type: "CAROUSEL", children: children.join(","), caption },
      "POST",
      deadline,
    );
    await this.waitUntilReady(parent.id, deadline);
    const published = await this.request(
      `${this.userId}/media_publish`,
      { creation_id: parent.id },
      "POST",
      deadline,
    );
    if (!/^\d+$/.test(published.id ?? ""))
      throw new Error(
        "Instagram did not return a media ID; reconcile before retrying",
      );
    return published;
  }
  async mediaInsights(mediaId, metrics) {
    if (!/^\d+$/.test(mediaId)) throw new Error("Invalid media ID");
    return this.request(`${mediaId}/insights`, { metric: metrics.join(",") });
  }
}
