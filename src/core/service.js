import { normalizeIdentity } from "./identity.js";
import {
  buildGenerationBrief,
  enforceHashtagLimit,
  validateCarousel,
} from "./carousel.js";
import { choosePillar, updatePillarWeights } from "./strategy.js";

export class GhostwriterService {
  /** @param {{store: any, ai: any, instagram: any, imageProvider?: {generateImage: (input: any) => Promise<any>} | null}} adapters */
  constructor({ store, ai, instagram, imageProvider = null }) {
    this.store = store;
    this.ai = ai;
    this.instagram = instagram;
    this.imageProvider = imageProvider;
  }

  async saveIdentity(input) {
    const identity = normalizeIdentity(input);
    return this.store.write("identity", identity);
  }

  async updateState(key, fallback, mutate) {
    if (this.store.update) return this.store.update(key, fallback, mutate);
    return this.store.write(key, mutate(await this.store.read(key, fallback)));
  }

  async getIdentity() {
    return this.store.read("identity");
  }
  async history() {
    return this.store.read("history", []);
  }
  async getDraft(draftId) {
    return this.store.read(`draft-${draftId}`);
  }
  async getSchedules() {
    return this.store.read("schedules", []);
  }

  async recordMetrics(mediaId, metrics) {
    const history = await this.updateState("history", [], (history) => {
      const entry = history.find((entry) => entry.mediaId === mediaId);
      if (!entry)
        throw new Error("Published media not found in Ghostwriter history");
      entry.metrics = { ...(entry.metrics ?? {}), ...metrics };
      entry.metricsUpdatedAt = new Date().toISOString();
      return history;
    });
    return history.find((entry) => entry.mediaId === mediaId);
  }

  async ensureHistory(published) {
    return this.updateState("history", [], (history) => {
      if (
        !history.some(
          (entry) =>
            entry.mediaId === published.mediaId || entry.id === published.id,
        )
      ) {
        history.push({
          id: published.id,
          mediaId: published.mediaId,
          pillar: published.pillar,
          metrics: {},
          publishedAt: published.publishedAt,
        });
      }
      return history;
    });
  }

  async generate({ objective = "engagement", pillar } = {}) {
    const identity = await this.getIdentity();
    if (!identity) throw new Error("Create an identity first");
    const history = await this.history();
    const weights = updatePillarWeights(identity.brand.contentPillars, history);
    const selected = pillar ?? choosePillar(weights);
    const brief = buildGenerationBrief(identity, selected, objective);
    const carousel = await this.ai.generateJson(
      "You are Ghostwriter, an expert social content strategist. Return valid JSON only with: title, pillar, hook, slides[{copy,visualPrompt}], caption, promptPack[]. Never invent performance claims.",
      brief,
    );
    carousel.pillar = carousel.pillar ?? selected;
    carousel.caption = enforceHashtagLimit(
      carousel.caption ?? "",
      identity.brand.maxHashtags,
    );
    const validation = validateCarousel(carousel);
    if (!validation.ok)
      throw new Error(
        `Generated carousel invalid: ${validation.errors.join("; ")}`,
      );
    const id = crypto.randomUUID();
    const draft = {
      ...carousel,
      id,
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    await this.store.write(`draft-${id}`, draft);
    return { ...draft, strategyWeights: weights };
  }

  async generateImages({ draftId }) {
    if (!this.imageProvider) throw new Error("No image provider is configured");
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "draft")
      throw new Error("Only unpublished drafts can generate images");
    if (
      !Array.isArray(draft.slides) ||
      draft.slides.length < 2 ||
      draft.slides.length > 10
    )
      throw new Error("Draft has no valid slides");
    const identity = await this.getIdentity();
    const assets = [];
    for (let index = 0; index < draft.slides.length; index++) {
      const slide = draft.slides[index];
      const generated = await this.imageProvider.generateImage({
        prompt: slide.visualPrompt,
        identity,
        draft,
        slideIndex: index,
      });
      assets.push(generated);
    }
    const updated = {
      ...draft,
      generatedAssets: assets,
      assetsGeneratedAt: new Date().toISOString(),
    };
    return this.updateState(`draft-${draftId}`, null, (current) => {
      if (current?.status !== "draft")
        throw new Error("Draft changed during image generation");
      return {
        ...current,
        generatedAssets: updated.generatedAssets,
        assetsGeneratedAt: updated.assetsGeneratedAt,
      };
    });
  }

  async publish({ draftId, imageUrls, idempotencyKey } = {}) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");
    if (draft.status === "published" && draft.mediaId) {
      await this.ensureHistory(draft);
      return draft;
    }
    if (draft.status === "publishing")
      throw new Error("Draft is already being published");
    if (draft.status === "publish_failed")
      throw new Error(
        "Previous publishing attempt failed; reconcile with Instagram before retrying",
      );
    if (
      !Array.isArray(imageUrls) ||
      imageUrls.length < 2 ||
      imageUrls.length > 10
    ) {
      throw new Error("Publishing requires 2-10 image URLs");
    }

    const key = `draft:${draftId}`;
    const existing = await this.store.read(`publish-idempotency-${key}`);
    if (existing?.mediaId) {
      const reconciled = {
        ...draft,
        status: "published",
        mediaId: existing.mediaId,
        publishedAt: existing.publishedAt,
        imageUrls,
      };
      await this.store.write(`draft-${draftId}`, reconciled);
      await this.ensureHistory(reconciled);
      return reconciled;
    }

    if (this.store.claimPublish) {
      if (!(await this.store.claimPublish(draftId)))
        throw new Error("Draft is already claimed or cannot be published");
    } else {
      await this.store.write(`draft-${draftId}`, {
        ...draft,
        status: "publishing",
        publishingStartedAt: new Date().toISOString(),
      });
    }
    try {
      const result = await this.instagram.publishCarousel({
        imageUrls,
        caption: draft.caption,
        idempotencyKey: key,
      });
      if (!result?.id) throw new Error("Missing published media ID");
      const publishedAt = new Date().toISOString();
      const published = {
        ...draft,
        status: "published",
        mediaId: result.id,
        publishedAt,
        imageUrls,
      };
      await this.store.write(`draft-${draftId}`, published);
      await this.store.write(`publish-idempotency-${key}`, {
        draftId,
        mediaId: result.id,
        publishedAt,
      });
      await this.ensureHistory(published);
      return published;
    } catch (error) {
      const current = await this.getDraft(draftId);
      // Do not erase a successful media ID when a later persistence operation fails.
      if (current?.status !== "published")
        await this.store.write(`draft-${draftId}`, {
          ...draft,
          status: "publish_failed",
          publishError: "Publishing failed; manual reconciliation required",
          publishFailedAt: new Date().toISOString(),
        });
      throw error;
    }
  }

  /** @param {{draftId?: string, runAt?: string, imageUrls?: string[], approvalRequired?: boolean}} options */
  async schedule({
    draftId,
    runAt,
    imageUrls = [],
    approvalRequired = true,
  } = {}) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error("Draft not found");
    const when = new Date(runAt);
    if (Number.isNaN(when.getTime()))
      throw new Error("runAt must be a valid date/time");
    const id = crypto.randomUUID();
    const item = {
      id,
      draftId,
      runAt: when.toISOString(),
      imageUrls,
      approvalRequired,
      approved: !approvalRequired,
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };
    await this.updateState("schedules", [], (schedules) => [
      ...schedules,
      item,
    ]);
    return item;
  }

  async approveSchedule(scheduleId) {
    const schedules = await this.updateState("schedules", [], (schedules) => {
      const item = schedules.find((item) => item.id === scheduleId);
      if (!item || item.status !== "scheduled")
        throw new Error("Scheduled job not found");
      item.approved = true;
      item.approvedAt = new Date().toISOString();
      return schedules;
    });
    return schedules.find((item) => item.id === scheduleId);
  }

  async runDueSchedules(now = new Date(), maxJobs = 1) {
    const schedules = await this.getSchedules();
    const nowMs = new Date(now).getTime();
    const results = [];
    for (let index = 0; index < schedules.length; index++) {
      const item = schedules[index];
      if (
        item.status !== "scheduled" ||
        !item.approved ||
        new Date(item.runAt).getTime() > nowMs
      )
        continue;
      try {
        await this.updateState("schedules", [], (current) => {
          const job = current.find((job) => job.id === item.id);
          if (!job || job.status !== "scheduled" || !job.approved)
            throw new Error("Already claimed");
          job.status = "running";
          job.startedAt = new Date().toISOString();
          return current;
        });
      } catch {
        continue;
      }
      schedules[index] = { ...item, status: "running" };
      try {
        const published = await this.publish({
          draftId: item.draftId,
          imageUrls: item.imageUrls,
          idempotencyKey: `schedule:${item.id}`,
        });
        schedules[index] = {
          ...schedules[index],
          status: "completed",
          completedAt: new Date().toISOString(),
          mediaId: published.mediaId,
        };
        results.push({
          scheduleId: item.id,
          ok: true,
          mediaId: published.mediaId,
        });
      } catch (error) {
        schedules[index] = {
          ...schedules[index],
          status: "failed",
          failedAt: new Date().toISOString(),
          error: String(error?.message ?? error),
        };
        results.push({
          scheduleId: item.id,
          ok: false,
          error: String(error?.message ?? error),
        });
      }
      await this.updateState("schedules", [], (current) =>
        current.map((job) => (job.id === item.id ? schedules[index] : job)),
      );
      if (results.length >= maxJobs) break;
    }
    return results;
  }
}
