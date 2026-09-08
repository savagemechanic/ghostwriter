import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIdentity, normalizeIdentity } from '../src/core/identity.js';
import { enforceHashtagLimit, validateCarousel } from '../src/core/carousel.js';
import { scorePost, updatePillarWeights, choosePillar } from '../src/core/strategy.js';
import { GhostwriterService } from '../src/core/service.js';

function memoryStore(seed = []) {
  const state = new Map(seed);
  return {
    state,
    async read(name, fallback = null) { return state.has(name) ? structuredClone(state.get(name)) : fallback; },
    async write(name, value) { state.set(name, structuredClone(value)); return value; },
  };
}

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
  const store = memoryStore([
    ['draft-d1', { id: 'd1', status: 'draft' }],
    ['history', [{ id: 'd1', mediaId: 'm1', pillar: 'AI', metrics: {} }]],
  ]);
  const service = new GhostwriterService({ store, ai: {}, instagram: {} });
  assert.equal((await service.getDraft('d1')).id, 'd1');
  const entry = await service.recordMetrics('m1', { impressions: 1000, shares: 25 });
  assert.equal(entry.metrics.shares, 25);
  assert.ok(entry.metricsUpdatedAt);
});

test('publishing is idempotent and does not duplicate history', async () => {
  let calls = 0;
  const store = memoryStore([
    ['draft-d1', { id: 'd1', status: 'draft', caption: 'hello', pillar: 'AI' }],
    ['history', []],
  ]);
  const instagram = {
    async publishCarousel() { calls++; return { id: 'media-1' }; },
  };
  const service = new GhostwriterService({ store, ai: {}, instagram });
  const first = await service.publish({ draftId: 'd1', imageUrls: ['https://x/a.jpg','https://x/b.jpg'] });
  const second = await service.publish({ draftId: 'd1', imageUrls: ['https://x/a.jpg','https://x/b.jpg'] });
  assert.equal(first.mediaId, 'media-1');
  assert.equal(second.mediaId, 'media-1');
  assert.equal(calls, 1);
  assert.equal((await service.history()).length, 1);
});

test('schedules require approval by default and run once after approval', async () => {
  let calls = 0;
  const store = memoryStore([
    ['draft-d1', { id: 'd1', status: 'draft', caption: 'hello', pillar: 'AI' }],
    ['history', []],
  ]);
  const instagram = { async publishCarousel() { calls++; return { id: 'media-scheduled' }; } };
  const service = new GhostwriterService({ store, ai: {}, instagram });
  const item = await service.schedule({
    draftId: 'd1',
    runAt: '2026-09-08T12:00:00.000Z',
    imageUrls: ['https://x/a.jpg','https://x/b.jpg']
  });
  assert.equal(item.approvalRequired, true);
  assert.equal(item.approved, false);
  assert.deepEqual(await service.runDueSchedules(new Date('2026-09-08T13:00:00.000Z')), []);
  await service.approveSchedule(item.id);
  const results = await service.runDueSchedules(new Date('2026-09-08T13:00:00.000Z'));
  assert.equal(results[0].ok, true);
  assert.equal(calls, 1);
  assert.equal((await service.getSchedules())[0].status, 'completed');
});

test('image generation uses a provider interface and persists assets', async () => {
  const store = memoryStore([
    ['identity', normalizeIdentity({ name: 'Savage', brand: { contentPillars: ['AI'] } })],
    ['draft-d1', {
      id: 'd1', status: 'draft', title: 'T', pillar: 'AI',
      slides: [
        { copy: 'a', visualPrompt: 'prompt-a' },
        { copy: 'b', visualPrompt: 'prompt-b' },
      ]
    }],
  ]);
  const seen = [];
  const imageProvider = {
    async generateImage(input) { seen.push(input.prompt); return { url: `https://assets/${input.slideIndex}.png` }; },
  };
  const service = new GhostwriterService({ store, ai: {}, instagram: {}, imageProvider });
  const draft = await service.generateImages({ draftId: 'd1' });
  assert.deepEqual(seen, ['prompt-a', 'prompt-b']);
  assert.equal(draft.generatedAssets.length, 2);
  assert.ok(draft.assetsGeneratedAt);
});
