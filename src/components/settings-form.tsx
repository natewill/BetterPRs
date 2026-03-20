"use client";

import { useState, useTransition } from "react";
import type { ScoreFieldConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";

type SettingsFormProps = {
  repoId: number;
  initialTeamMembers: string[];
  initialBotUsers: string[];
  initialScopeValues: string[];
  initialTypeValues: string[];
  initialScoreFields: ScoreFieldConfig[];
};

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeKey(input: string): string {
  return input.trim().replace(/\s+/g, "_");
}

function normalizeOption(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "_");
}

export function SettingsForm(props: SettingsFormProps) {
  const [teamMembersText, setTeamMembersText] = useState(
    props.initialTeamMembers.join(", "),
  );
  const [botUsersText, setBotUsersText] = useState(props.initialBotUsers.join(", "));
  const [scopeValues, setScopeValues] = useState<string[]>(props.initialScopeValues);
  const [typeValues, setTypeValues] = useState<string[]>(props.initialTypeValues);
  const [scoreFields, setScoreFields] = useState<ScoreFieldConfig[]>(props.initialScoreFields);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>("");

  function updateWeight(index: number, value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }
    setScoreFields((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index
          ? { ...field, weight: parsed }
          : field,
      ),
    );
  }

  function updateKey(index: number, value: string) {
    setScoreFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, key: value } : field)),
    );
  }

  function updatePrompt(index: number, value: string) {
    setScoreFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, prompt: value } : field)),
    );
  }

  function addField() {
    const nextIndex = scoreFields.length + 1;
    setScoreFields((current) => [
      ...current,
      {
        key: `custom_${nextIndex}`,
        weight: 0,
        prompt: "Score this dimension strictly from concrete evidence in the PR.",
      },
    ]);
  }

  function removeField(index: number) {
    setScoreFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  }

  function updateScopeValue(index: number, value: string) {
    const next = normalizeOption(value);
    if (!next) {
      return;
    }
    setScopeValues((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }

  function addScopeValue() {
    const nextIndex = scopeValues.length + 1;
    setScopeValues((current) => [...current, `scope_${nextIndex}`]);
  }

  function removeScopeValue(index: number) {
    setScopeValues((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateTypeValue(index: number, value: string) {
    const next = normalizeOption(value);
    if (!next) {
      return;
    }
    setTypeValues((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }

  function addTypeValue() {
    const nextIndex = typeValues.length + 1;
    setTypeValues((current) => [...current, `type_${nextIndex}`]);
  }

  function removeTypeValue(index: number) {
    setTypeValues((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payloadScoreFields = scoreFields.map((field) => ({
      key: normalizeKey(field.key),
      weight: field.weight,
      prompt: field.prompt.trim(),
    }));
    const payloadScopeValues = scopeValues.map(normalizeOption).filter((value) => value.length > 0);
    const payloadTypeValues = typeValues.map(normalizeOption).filter((value) => value.length > 0);

    if (payloadScoreFields.some((field) => field.key.length === 0)) {
      setMessage("Each score field needs a key.");
      return;
    }

    if (payloadScoreFields.some((field) => field.prompt.length === 0)) {
      setMessage("Each score field needs a sub-prompt.");
      return;
    }

    if (payloadScoreFields.length === 0) {
      setMessage("At least one score field is required.");
      return;
    }
    if (payloadScopeValues.length === 0) {
      setMessage("At least one scope value is required.");
      return;
    }
    if (payloadTypeValues.length === 0) {
      setMessage("At least one type value is required.");
      return;
    }

    const keys = payloadScoreFields.map((field) => field.key);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      setMessage("Score field keys must be unique.");
      return;
    }
    if (new Set(payloadScopeValues).size !== payloadScopeValues.length) {
      setMessage("Scope values must be unique.");
      return;
    }
    if (new Set(payloadTypeValues).size !== payloadTypeValues.length) {
      setMessage("Type values must be unique.");
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/repos/${props.repoId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamMembers: parseCommaSeparated(teamMembersText),
          botUsers: parseCommaSeparated(botUsersText),
          scopeValues: payloadScopeValues,
          typeValues: payloadTypeValues,
          scoreFields: payloadScoreFields,
        }),
      });

      if (response.status === 503) {
        const payload = (await response.json()) as { error?: string };
        setMessage(payload.error ?? "Admin OAuth is not configured.");
        return;
      }

      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/api/auth/github/start?next=${encodeURIComponent(next)}`);
        return;
      }

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setMessage(payload.error ?? "Failed to save settings");
        return;
      }

      const payload = (await response.json()) as {
        scoreRecomputeQueued?: boolean;
        warning?: string;
      };
      if (payload.warning) {
        setMessage(payload.warning);
        return;
      }
      if (payload.scoreRecomputeQueued) {
        setMessage("Saved settings. Score recompute queued.");
        return;
      }
      setMessage("Saved settings.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-xl bg-surface border border-border p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-heading">Repo settings</h2>
          <p className="mt-0.5 text-sm text-body">
            Team-member PRs are excluded from ranking. Bot PRs are still shown.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              Recomputing scores...
            </span>
          ) : (
            "Save"
          )}
        </Button>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-heading">Team members</span>
        <input
          className="w-full px-3 py-2 text-sm"
          value={teamMembersText}
          onChange={(event) => setTeamMembersText(event.target.value)}
          placeholder="alice, bob, charlie"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-heading">Known bots</span>
        <input
          className="w-full px-3 py-2 text-sm"
          value={botUsersText}
          onChange={(event) => setBotUsersText(event.target.value)}
          placeholder="dependabot[bot], github-actions[bot]"
        />
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-heading">Scoring fields</p>
          <Button type="button" onClick={addField}>
            Add field
          </Button>
        </div>
        <div className="space-y-3">
          {scoreFields.map((field, index) => (
            <div key={index} className="rounded-lg border border-border-subtle p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-subtle">Key</span>
                  <input
                    className="w-full px-2.5 py-1.5 font-mono text-sm"
                    value={field.key}
                    onChange={(event) => updateKey(index, event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-subtle">Weight</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full px-2.5 py-1.5 font-mono text-sm"
                    value={field.weight}
                    onChange={(event) => updateWeight(index, event.target.value)}
                  />
                </label>
              </div>
              <label className="mt-2 block">
                <span className="mb-1 block text-xs text-subtle">LLM sub-prompt for this field</span>
                <textarea
                  className="w-full px-2.5 py-2 text-sm"
                  rows={3}
                  value={field.prompt}
                  onChange={(event) => updatePrompt(index, event.target.value)}
                />
              </label>
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  onClick={() => removeField(index)}
                  disabled={scoreFields.length === 1}
                >
                  Remove
                </Button>
              </div>
              {field.key === "contributorTrust" ? (
                <p className="mt-2 text-xs text-subtle">
                  contributorTrust is deterministic from merged PR count in this repo.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-heading">Allowed scopes</p>
          <Button type="button" onClick={addScopeValue}>
            Add scope
          </Button>
        </div>
        <div className="space-y-2">
          {scopeValues.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                className="w-full px-2.5 py-1.5 font-mono text-sm"
                value={value}
                onChange={(event) => updateScopeValue(index, event.target.value)}
              />
              <Button
                type="button"
                onClick={() => removeScopeValue(index)}
                disabled={scopeValues.length === 1}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-heading">Allowed types</p>
          <Button type="button" onClick={addTypeValue}>
            Add type
          </Button>
        </div>
        <div className="space-y-2">
          {typeValues.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                className="w-full px-2.5 py-1.5 font-mono text-sm"
                value={value}
                onChange={(event) => updateTypeValue(index, event.target.value)}
              />
              <Button
                type="button"
                onClick={() => removeTypeValue(index)}
                disabled={typeValues.length === 1}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </div>

      {message ? <p className="pt-1 text-sm text-accent">{message}</p> : null}
    </form>
  );
}
