export function validateIdentity(input) {
  const errors = [];
  if (!input || typeof input !== 'object') errors.push('identity must be an object');
  if (!input?.name?.trim()) errors.push('name is required');
  if (!Array.isArray(input?.brand?.contentPillars) || input.brand.contentPillars.length === 0) {
    errors.push('brand.contentPillars must contain at least one pillar');
  }
  if (input?.brand?.maxHashtags != null && (!Number.isInteger(input.brand.maxHashtags) || input.brand.maxHashtags < 0)) {
    errors.push('brand.maxHashtags must be a non-negative integer');
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeIdentity(input) {
  const validation = validateIdentity(input);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return {
    name: input.name.trim(),
    visual: {
      appearance: input.visual?.appearance ?? [],
      wardrobeRules: input.visual?.wardrobeRules ?? [],
      signatureDetails: input.visual?.signatureDetails ?? [],
      forbiddenInconsistencies: input.visual?.forbiddenInconsistencies ?? []
    },
    brand: {
      voice: input.brand?.voice ?? [],
      audience: input.brand?.audience ?? [],
      contentPillars: input.brand.contentPillars,
      ctaRules: input.brand?.ctaRules ?? [],
      maxHashtags: input.brand?.maxHashtags ?? 5
    },
    creative: {
      cinematography: input.creative?.cinematography ?? [],
      compositionRules: input.creative?.compositionRules ?? [],
      typographyRules: input.creative?.typographyRules ?? []
    }
  };
}
