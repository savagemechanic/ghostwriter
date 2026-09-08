import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIdentity, normalizeIdentity } from '../src/core/identity.js';
import { enforceHashtagLimit, validateCarousel } from '../src/core/carousel.js';
import { scorePost, updatePillarWeights, choosePillar } from '../src/core/strategy.js';
import { GhostwriterService } from '../src/core/service.js';

test('identity validates and defaults hashtag limit', () => {
  const raw = { name: 'Savage', brand: { contentPillars: ['AI'] } };
  assert.equal(validateIdentity(raw).ok, true);
  assert.equal(normalizeIdentity(raw).brand.maxHashtags, 5);
});

test('caption hashtag limit is enforced', () => {
  assert.equal(enforceHashtagLimit('x #1 #2 #3 #4 #5 #6', 5), 'x #1 #2 #3 #4 #5');
});

test('carousel requires 2-10 valid slides', () => {
  const c = { title:'t', pillar:'AI', slides:[{copy:'a',visualPrompt:'x'},{copy:'b',visualPrompt:'y'}] };
  assert.equal(validateCarousel(c).ok, true);
});

test('strategy rewards high-intent actions', () => {
  const weak = scorePost({ impressions:1000, likes:100 });
  const strong = scorePost({ impressions:1000, saves:30, shares:20, follows:10 });
  assert.ok(strong > weak);
});

test('weights favor historically stronger pillar', () => {
  const weights = updatePillarWeights(['AI','Lifestyle'], [
    { pillar:'AI', metrics:{ impressions:1000, shares:100 } },
    { pillar:'Lifestyle', metrics:{ impressions:1000, likes:5 } }
  ]);
  assert.ok(weights.AI > weights.Lifestyle);
  assert.equal(choosePillar({ AI: 1, Lifestyle: 0 }, () => 0.5), 'AI');
});

test('service reads drafts and records metrics for published media', async () => {
  const state = new Map([
    ['draft-d1', { id: 'd1', status: 'draft' }],
    ['history', [{ id: 'd1', mediaId: 'm1', pillar: 'AI', metrics: {} }]],
  ]);
  const store = {
    async read(name, fallback = null) { return state.has(name) ? structuredClone(state.get(name)) : fallback; },
    async write(name, value) { state.set(name, structuredClone(value)); return value; },
  };
  const service = new GhostwriterService({ store, ai: {}, instagram: {} });
  assert.equal((await service.getDraft('d1')).id, 'd1');
  const entry = await service.recordMetrics('m1', { impressions: 1000, shares: 25 });
  assert.equal(entry.metrics.shares, 25);
  assert.ok(entry.metricsUpdatedAt);
});
