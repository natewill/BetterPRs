# Open Source GitHub Filter V1 Plan

## Summary

Build a single Next.js app for `anomalyco/opencode` that:

- ingests open PRs on a 6-hour Trigger.dev schedule
- stores raw + derived data in Postgres via Drizzle
- asks Gemini for per-dimension scores + concise summaries
- computes final `0-100` score in the app from saved weights
- excludes only team-member PRs by settings

## Core Phases

1. Foundation and skeleton
2. GitHub ingestion and scheduling
3. Fact extraction and query layer
4. Gemini dimension scoring and app-owned final score
5. Product finish and settings

## Current Status

This repository now includes:

- schema and DB client (`src/lib/db/*`)
- GitHub ingestion + feature extraction (`src/lib/github.ts`, `src/lib/features.ts`)
- Gemini analysis + weighted scoring (`src/lib/gemini.ts`, `src/lib/scoring.ts`)
- refresh pipeline + Trigger tasks (`src/server/refresh.ts`, `trigger/tasks.ts`)
- API routes (`src/app/api/**`)
- dashboard, detail, and settings pages (`src/app/repos/**`, `src/app/settings/page.tsx`)
- viewed PR localStorage indicator (`src/components/viewed-badge.tsx`)
