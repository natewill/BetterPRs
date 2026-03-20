# BetterPRs

BetterPRs is a PR triage dashboard for open-source maintainers.

It watches a GitHub repo, ingests open pull requests on a schedule, asks an LLM to score the review dimensions that matter, and then ranks PRs so maintainers can quickly see which ones are most worth opening first.

## What It Does

- Pulls open PRs from GitHub on a recurring background schedule
- Stores PRs, linked issues, comments, changed files, and diff excerpts
- Scores each PR across dimensions like impact, clarity, urgency, size, trust, traction, readiness, and guidelines
- Computes a final weighted `0-100` score for ranking
- Shows a dashboard for `today`, `3d`, and `7d`
- Lets you filter by inferred scope and type
- Excludes team-member PRs from ranking
- Keeps bot PRs visible
- Shows a concise LLM summary before you open a PR
- Shows the real PR content underneath on the detail page

## What The Dashboard Shows

Each PR card is designed to help you decide whether the PR is worth your time before you click into it.

It includes:

- PR title
- author
- repo
- score
- inferred scope
- inferred type
- concise summary
- quick diff stats
- last updated time

The PR detail page adds:

- per-dimension score breakdown
- hover explanations for each score
- PR description rendered as markdown
- linked issues
- PR comments
- changed files
- GitHub-style diff view with syntax highlighting

## How Ranking Works

The LLM returns per-dimension scores for each PR.

BetterPRs then applies the saved weights in the app to produce the final ranking score. That means you can change the weights without rerunning analysis on every PR.

## What It Is Not

- not a GitHub replacement
- not a code review bot
- not an inline review tool
- not a write-back automation that comments on PRs or changes labels

BetterPRs is a read-optimized prioritization layer on top of GitHub.
