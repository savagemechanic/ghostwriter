import { normalizeIdentity } from './identity.js';
import { buildGenerationBrief, enforceHashtagLimit, validateCarousel } from './carousel.js';
import { choosePillar, updatePillarWeights } from './strategy.js';

export class GhostwriterService {
  constructor({ store, ai, instagram }) { this.store = store; this.ai = ai; this.instagram = instagram; }
  async saveIdentity(input) {
    const identity = normalizeIdentity(input);
    return this.store.write('identity', identity);
  }
  async getIdentity() { return this.store.read('identity'); }
  async history() { return this.store.read('history', []); }
  async getDraft(draftId) { return this.store.read(`draft-${draftId}`); }
  async recordMetrics(mediaId, metrics) {
    const history = await this.history();
    const index = history.findIndex(entry => entry.mediaId === mediaId);
    if (index < 0) throw new Error('Published media not found in Ghostwriter history');
    history[index] = { ...history[index], metrics: { ...(history[index].metrics ?? {}), ...metrics }, metricsUpdatedAt: new Date().toISOString() };
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
  async publish({ draftId, imageUrls }) {
    const draft = await this.store.read(`draft-${draftId}`);
    if (!draft) throw new Error('Draft not found');
    const result = await this.instagram.publishCarousel({ imageUrls, caption: draft.caption });
    const published = { ...draft, status: 'published', mediaId: result.id, publishedAt: new Date().toISOString(), imageUrls };
    await this.store.write(`draft-${draftId}`, published);
    const history = await this.history();
    history.push({ id: published.id, mediaId: published.mediaId, pillar: published.pillar, metrics: {} });
    await this.store.write('history', history);
    return published;
  }
}
