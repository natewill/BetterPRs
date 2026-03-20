import { schedules, task } from "@trigger.dev/sdk/v3";
import {
  analyzePrById,
  refreshActiveReposInternal,
  refreshRepoInternal,
  scoreRepoPrsByRepoId,
} from "@/server/refresh";

export const refreshActiveRepos = schedules.task({
  id: "refresh-active-repos",
  cron: {
    pattern: "0 */6 * * *",
    timezone: "America/New_York",
  },
  run: async () => {
    return refreshActiveReposInternal();
  },
});

export const refreshRepo = task({
  id: "refresh-repo",
  run: async (payload: { repoId: number; createdSinceIso?: string; updatedSinceIso?: string }) => {
    if (payload.updatedSinceIso) {
      const updatedSince = new Date(payload.updatedSinceIso);
      if (!Number.isFinite(updatedSince.getTime())) {
        throw new Error(`Invalid updatedSinceIso: ${payload.updatedSinceIso}`);
      }

      return refreshRepoInternal(payload.repoId, {
        kind: "updated_since",
        updatedSince,
      });
    }

    if (payload.createdSinceIso) {
      const createdSince = new Date(payload.createdSinceIso);
      if (!Number.isFinite(createdSince.getTime())) {
        throw new Error(`Invalid createdSinceIso: ${payload.createdSinceIso}`);
      }

      return refreshRepoInternal(payload.repoId, {
        kind: "created_since",
        createdSince,
      });
    }

    return refreshRepoInternal(payload.repoId);
  },
});

export const analyzePr = task({
  id: "analyze-pr",
  queue: {
    name: "analyze-pr",
    concurrencyLimit: 4,
  },
  run: async (payload: { prId: number }) => {
    return analyzePrById(payload.prId);
  },
});

export const scoreRepoPrs = task({
  id: "score-repo-prs",
  run: async (payload: { repoId: number }) => {
    await scoreRepoPrsByRepoId(payload.repoId);
    return { ok: true };
  },
});
