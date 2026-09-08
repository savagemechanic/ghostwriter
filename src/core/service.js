import { normalizeIdentity } from './identity.js';
import { buildGenerationBrief, enforceHashtagLimit, validateCarousel } from './carousel.js';
import { choosePillar, updatePillarWeights } from './strategy.js';

export class GhostwriterService {
  constructor({ store, ai, instagram, imageProvider = null }) {
    this.store = store;
    this.ai = ai;
    this.instagram = instagram;
    this.imageProvider = imageProvider;
  }

  async saveIdentity(input) {
    const identity = normalizeIdentity(input);
    return this.store.write('identity', identity);
  }

  async getIdentity() { return this.store.read('identity'); }
  async history() { return this.store.read('history', []); }
  async getDraft(draftId) { return this.store.read(`draft-${draftId}`); }
  async getSchedules() { return this.store.read('schedules', []); }

  async recordMetrics(mediaId, metrics) {
    const history = await this.history();
    const index = history.findIndex(entry => entry.mediaId === mediaId);
    if (index < 0) throw new Error('Published media not found in Ghostwriter history');
    history[index] = {
      ...history[index],
      metrics: { ...(history[index].metrics ?? {}), ...metrics },
      metricsUpdatedAt: new Date().toISOString()
    };
    await this.store.write('history', history);
    return history[index];
  }

  async generate({ objective = 'engagement', pillar } = {}) {
    const identity = await this.getIdentity();
    if (!identity) throw new Error('Create an identity first');
    const history = await this.history();
    const weights = updatePillarWeights(identity.brand.contentPillars, history);
    const selected = pillar ?? choosePillar(weights);
    const brief = buildGenerationBrief(identity, selected, objective);
    const carousel = await this.ai.generateJson(
      'You are Ghostwriter, an expert social content strategist. Return valid JSON only with: title, pillar, hook, slides[{copy,visualPrompt}], caption, promptPack[]. Never invent performance claims.',
      brief
    );
    carousel.pillar = carousel.pillar ?? selected;
    carousel.caption = enforceHashtagLimit(carousel.caption ?? '', identity.brand.maxHashtags);
    const validation = validateCarousel(carousel);
    if (!validation.ok) throw new Error(`Generated carousel invalid: ${validation.errors.join('; ')}`);
    const id = crypto.randomUUID();
    const draft = { id, status: 'draft', createdAt: new Date().toISOString(), ...carousel };
    await this.store.write(`draft-${id}`, draft);
    return { ...draft, strategyWeights: weights };
  }

  async generateImages({ draftId }) {
    if (!this.imageProvider) throw new Error('No image provider is configured');
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error('Draft not found');
    if (!Array.isArray(draft.slides) || draft.slides.length < 2) throw new Error('Draft has no valid slides');
    const identity = await this.getIdentity();
    const assets = [];
    for (let index = 0; index < draft.slides.length; index++) {
      const slide = draft.slides[index];
      const generated = await this.imageProvider.generateImage({
        prompt: slide.visualPrompt,
        identity,
        draft,
        slideIndex: index
      });
      assets.push(generated);
    }
    const updated = { ...draft, generatedAssets: assets, assetsGeneratedAt: new Date().toISOString() };
    await this.store.write(`draft-${draftId}`, updated);
    return updated;
  }

  async publish({ draftId, imageUrls, idempotencyKey } = {}) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error('Draft not found');
    if (draft.status === 'published' && draft.mediaId) return draft;
    if (draft.status === 'publishing') throw new Error('Draft is already being published');
    if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
      throw new Error('Publishing requires 2-10 image URLs');
    }

    const key = idempotencyKey ?? `draft:${draftId}`;
    const existing = await this.store.read(`publish-idempotency-${key}`);
    if (existing?.mediaId) {
      const reconciled = { ...draft, status: 'published', mediaId: existing.mediaId, publishedAt: existing.publishedAt, imageUrls };
      await this.store.write(`draft-${draftId}`, reconciled);
      return reconciled;
    }

    await this.store.write(`draft-${draftId}`, { ...draft, status: 'publishing', publishingStartedAt: new Date().toISOString() });
    try {
      const result = await this.instagram.publishCarousel({ imageUrls, caption: draft.caption, idempotencyKey: key });
      const publishedAt = new Date().toISOString();
      const published = { ...draft, status: 'published', mediaId: result.id, publishedAt, imageUrls };
      await this.store.write(`draft-${draftId}`, published);
      await this.store.write(`publish-idempotency-${key}`, { draftId, mediaId: result.id, publishedAt });
      const history = await this.history();
      if (!history.some(entry => entry.mediaId === result.id || entry.id === published.id)) {
        history.push({ id: published.id, mediaId: published.mediaId, pillar: published.pillar, metrics: {}, publishedAt });
        await this.store.write('history', history);
      }
      return published;
    } catch (error) {
      await this.store.write(`draft-${draftId}`, { ...draft, status: 'publish_failed', publishError: String(error?.message ?? error), publishFailedAt: new Date().toISOString() });
      throw error;
    }
  }

  /** @param {{draftId?: string, runAt?: string, imageUrls?: string[], approvalRequired?: boolean}} options */
  async schedule({ draftId, runAt, imageUrls = [], approvalRequired = true } = {}) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error('Draft not found');
    const when = new Date(runAt);
    if (Number.isNaN(when.getTime())) throw new Error('runAt must be a valid date/time');
    const schedules = await this.getSchedules();
    const id = crypto.randomUUID();
    const item = {
      id,
      draftId,
      runAt: when.toISOString(),
      imageUrls,
      approvalRequired,
      approved: !approvalRequired,
      status: 'scheduled',
      createdAt: new Date().toISOString()
    };
    schedules.push(item);
    await this.store.write('schedules', schedules);
    return item;
  }

  async approveSchedule(scheduleId) {
    const schedules = await this.getSchedules();
    const index = schedules.findIndex(item => item.id === scheduleId);
    if (index < 0) throw new Error('Schedule not found');
    schedules[index] = { ...schedules[index], approved: true, approvedAt: new Date().toISOString() };
    await this.store.write('schedules', schedules);
    return schedules[index];
  }

  async runDueSchedules(now = new Date()) {
    const schedules = await this.getSchedules();
    const nowMs = new Date(now).getTime();
    const results = [];
    for (let index = 0; index < schedules.length; index++) {
      const item = schedules[index];
      if (item.status !== 'scheduled' || !item.approved || new Date(item.runAt).getTime() > nowMs) continue;
      schedules[index] = { ...item, status: 'running', startedAt: new Date().toISOString() };
      await this.store.write('schedules', schedules);
      try {
        const published = await this.publish({ draftId: item.draftId, imageUrls: item.imageUrls, idempotencyKey: `schedule:${item.id}` });
        schedules[index] = { ...schedules[index], status: 'completed', completedAt: new Date().toISOString(), mediaId: published.mediaId };
        results.push({ scheduleId: item.id, ok: true, mediaId: published.mediaId });
      } catch (error) {
        schedules[index] = { ...schedules[index], status: 'failed', failedAt: new Date().toISOString(), error: String(error?.message ?? error) };
        results.push({ scheduleId: item.id, ok: false, error: String(error?.message ?? error) });
      }
      await this.store.write('schedules', schedules);
    }
    return results;
  }
}
