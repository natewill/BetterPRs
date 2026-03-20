export const defaultBotUsers = ["github-actions[bot]"] as const;

export function mergeBotUsers(botUsers: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const user of [...defaultBotUsers, ...botUsers]) {
    const normalized = user.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}
