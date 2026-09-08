const sleep = ms => new Promise(r => setTimeout(r, ms));

export class InstagramPublisher {
  constructor({ graphBase = 'https://graph.facebook.com', graphVersion, userId, accessToken }) {
    this.base = `${graphBase.replace(/\/$/, '')}/${graphVersion}`;
    this.userId = userId;
    this.accessToken = accessToken;
  }
  #assertConfigured() {
    if (!this.userId || !this.accessToken) throw new Error('Instagram publisher is not configured');
  }
  async #post(path, params) {
    this.#assertConfigured();
    const body = new URLSearchParams({ ...params, access_token: this.accessToken });
    const res = await fetch(`${this.base}/${path}`, { method: 'POST', body });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(`Instagram API: ${JSON.stringify(json.error ?? json)}`);
    return json;
  }
  async #get(path, params = {}) {
    this.#assertConfigured();
    const qs = new URLSearchParams({ ...params, access_token: this.accessToken });
    const res = await fetch(`${this.base}/${path}?${qs}`);
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(`Instagram API: ${JSON.stringify(json.error ?? json)}`);
    return json;
  }
  async waitUntilReady(containerId, { attempts = 20, delayMs = 3000 } = {}) {
    for (let i = 0; i < attempts; i++) {
      const status = await this.#get(containerId, { fields: 'status_code,status' });
      if (status.status_code === 'FINISHED') return status;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new Error(`Container ${status.status_code}: ${status.status ?? ''}`);
      await sleep(delayMs);
    }
    throw new Error('Timed out waiting for Instagram media container');
  }
  async publishCarousel({ imageUrls, caption }) {
    if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) throw new Error('Instagram carousel requires 2-10 images');
    const children = [];
    for (const imageUrl of imageUrls) {
      const item = await this.#post(`${this.userId}/media`, { image_url: imageUrl, is_carousel_item: 'true' });
      await this.waitUntilReady(item.id);
      children.push(item.id);
    }
    const parent = await this.#post(`${this.userId}/media`, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption
    });
    await this.waitUntilReady(parent.id);
    return this.#post(`${this.userId}/media_publish`, { creation_id: parent.id });
  }
  async mediaInsights(mediaId, metrics) {
    return this.#get(`${mediaId}/insights`, { metric: metrics.join(',') });
  }
}
