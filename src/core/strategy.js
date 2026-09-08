function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function scorePost(metrics = {}) {
  const impressions = Math.max(1, Number(metrics.impressions ?? metrics.reach ?? 1));
  const saves = Number(metrics.saves ?? 0);
  const shares = Number(metrics.shares ?? 0);
  const comments = Number(metrics.comments ?? 0);
  const likes = Number(metrics.likes ?? 0);
  const follows = Number(metrics.follows ?? 0);
  const profileVisits = Number(metrics.profileVisits ?? 0);
  const weighted = saves * 5 + shares * 6 + comments * 3 + follows * 8 + profileVisits * 2 + likes * 0.5;
  return Number((weighted / impressions).toFixed(6));
}

export function updatePillarWeights(pillars, history = []) {
  const scores = new Map(pillars.map(p => [p, []]));
  for (const post of history) if (scores.has(post.pillar)) scores.get(post.pillar).push(scorePost(post.metrics));
  const raw = pillars.map(p => {
    const vals = scores.get(p);
    const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0.02;
    return [p, clamp(avg, 0.001, 1)];
  });
  const total = raw.reduce((s, [,v]) => s + v, 0) || 1;
  return Object.fromEntries(raw.map(([p,v]) => [p, Number((v / total).toFixed(4))]));
}

export function choosePillar(weights, random = Math.random) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s,[,v]) => s + v, 0);
  let r = random() * total;
  for (const [pillar, weight] of entries) { r -= weight; if (r <= 0) return pillar; }
  return entries.at(-1)?.[0];
}
