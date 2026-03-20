import { createHash } from "node:crypto";
import type {
  GithubIssueComment,
  GithubPullFile,
  GithubPullRequestListItem,
} from "@/lib/github";

type InferenceInput = {
  pr: GithubPullRequestListItem;
  changedFiles: GithubPullFile[];
};

export type ExtractedFeatures = {
  contentHash: string;
};

export function countHumanComments(
  comments: GithubIssueComment[],
  knownBots: string[],
): number {
  const botSet = new Set(knownBots.map((value) => value.toLowerCase()));
  return comments.filter((comment) => {
    const author = comment.user.login.toLowerCase();
    if (botSet.has(author)) {
      return false;
    }
    return !author.endsWith("[bot]");
  }).length;
}

export function extractFeatures(input: InferenceInput): ExtractedFeatures {
  const body = input.pr.body ?? "";
  const additions = input.changedFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = input.changedFiles.reduce((sum, file) => sum + file.deletions, 0);
  const changedFiles = input.changedFiles.length;

  const hashInput = JSON.stringify({
    title: input.pr.title,
    body,
    updatedAt: input.pr.updated_at,
    files: input.changedFiles.map((file) => file.filename),
    additions,
    deletions,
    changedFiles,
  });

  return {
    contentHash: createHash("sha256").update(hashInput).digest("hex"),
  };
}
