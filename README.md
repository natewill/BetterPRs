# Open Source GitHub Filter (V1)

PR triage dashboard for maintainers.

## Stack

- Next.js App Router
- TypeScript
- Tailwind
- Postgres
- Drizzle ORM
- Trigger.dev
- GitHub REST API
- LLM API (currently Gemini)
- Sentry (error tracking)
- Vercel Analytics

## Env

Copy `.env.example` to `.env.local` and set:

- `DATABASE_URL`
- `GITHUB_TOKEN` (fine-grained PAT with read access to `anomalyco/opencode`)
- `GEMINI_API_KEY`
- `TRIGGER_SECRET_KEY`
- `TRIGGER_PROJECT_REF`
- `GITHUB_OAUTH_CLIENT_ID` (GitHub OAuth App client id)
- `GITHUB_OAUTH_CLIENT_SECRET` (GitHub OAuth App client secret)
- `ADMIN_AUTH_SECRET` (long random secret for signed admin session cookie)
- `SENTRY_DSN` (optional, server/edge error tracking)
- `NEXT_PUBLIC_SENTRY_DSN` (optional, browser error tracking)

## Commands

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

Optional:

```bash
pnpm trigger:dev
```

## Main Routes

- `/` (landing page)
- `/repos/anomalyco/opencode` (dashboard)
- `/repos/anomalyco/opencode/refresh-runs` (refresh status page)
- `/repos/anomalyco/opencode/pulls/:number` (PR detail)
- `/settings` (weights/team/bot config)

## API

- `GET /api/repos`
- `POST /api/repos`
- `GET /api/repos/:id`
- `PATCH /api/repos/:id/settings`
- `GET /api/repos/:id/pulls?window=today|3d|7d&scope=&type=&includeFiltered=`
- `GET /api/repos/:id/pulls/:number`
- `POST /api/repos/:id/refresh`
- `GET /api/repos/:id/refresh`

Write endpoints (`PATCH /settings`, `POST /refresh`) require admin GitHub OAuth.
Start auth at `GET /api/auth/github/start?next=/settings`.
Any GitHub user who signs in is allowed.

## Trigger Tasks

- `refresh-active-repos` (cron every 6h)
- `refresh-repo`
- `analyze-pr`
- `score-repo-prs`

## Product Rules Implemented

- Open PRs only
- Exclude team-member PRs by settings list
- Keep bot PRs visible
- The LLM returns per-dimension scores
- App computes final `0-100` score from weights

## Production Deploy (Vercel + Neon + Trigger Cloud)

1. **Database (Neon)**
   - Create a Neon project/database.
   - Copy the pooled connection string into `DATABASE_URL`.
   - Run schema + seed once:
     ```bash
     pnpm db:push
     pnpm db:seed
     ```

2. **Vercel**
   - Import this repo into Vercel.
   - Set env vars in the Vercel project:
     - `DATABASE_URL`
     - `GITHUB_TOKEN`
     - `GEMINI_API_KEY`
     - `TRIGGER_SECRET_KEY`
     - `TRIGGER_PROJECT_REF`
     - `GITHUB_OAUTH_CLIENT_ID`
     - `GITHUB_OAUTH_CLIENT_SECRET`
     - `ADMIN_AUTH_SECRET`
     - `SENTRY_DSN` (optional)
     - `NEXT_PUBLIC_SENTRY_DSN` (optional)
   - Deploy.

3. **Trigger.dev Cloud**
   - Connect Trigger project to this repo.
   - Deploy tasks from project root:
     ```bash
     npx trigger.dev@latest deploy
     ```
   - Ensure Trigger cloud env has the same server env vars as Vercel.

4. **Custom domain + TLS**
   - Add your domain in Vercel project settings.
   - Point DNS records to Vercel as shown in their domain setup UI.
   - TLS is automatic once DNS is verified.

## Notes

- This demo is single-tenant and currently focused on `anomalyco/opencode`.
- Keep GitHub and Gemini keys server-side only. Never expose in client code.
