export function validateCarousel(carousel) {
  const errors = [];
  if (!carousel?.title) errors.push('title is required');
  if (!carousel?.pillar) errors.push('pillar is required');
  if (!Array.isArray(carousel?.slides) || carousel.slides.length < 2 || carousel.slides.length > 10) {
    errors.push('slides must contain 2-10 items');
  }
  for (const [i, slide] of (carousel?.slides ?? []).entries()) {
    if (!slide?.copy?.trim()) errors.push(`slides[${i}].copy is required`);
    if (!slide?.visualPrompt?.trim()) errors.push(`slides[${i}].visualPrompt is required`);
  }
  return { ok: errors.length === 0, errors };
}

export function enforceHashtagLimit(caption, max = 5) {
  const tokens = caption.split(/\s+/);
  let seen = 0;
  return tokens.filter(token => {
    if (!token.startsWith('#')) return true;
    seen += 1;
    return seen <= max;
  }).join(' ').trim();
}

export function buildGenerationBrief(identity, pillar, objective = 'engagement') {
  return {
    objective,
    pillar,
    identity,
    requirements: {
      slideCount: { min: 5, max: 8 },
      firstSlide: 'A concise curiosity-driving hook, not clickbait.',
      body: 'Each slide must advance one idea and remain readable on mobile.',
      finalSlide: 'Deliver the promised value and one clear CTA.',
      caption: 'Add useful context and, when educational, include the practical prompt pack.',
      hashtags: `Use no more than ${identity.brand.maxHashtags} relevant hashtags.`
    }
  };
}
