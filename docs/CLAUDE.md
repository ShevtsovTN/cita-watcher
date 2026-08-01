# CLAUDE.md — docs/

This file provides guidance to Claude Code when working on documentation in this directory. See
the repo-root `CLAUDE.md` for the overall monorepo/cross-service picture.

## What this is

Planning documents for the monorepo that don't belong in any single part's own `CLAUDE.md` —
currently per-part implementation roadmaps that sequence work from the "early scaffold" state
described in the root `CLAUDE.md` toward a complete implementation.

- `NODE_WORKER_ROADMAP.md` — phased plan for `../node-worker` (automation/captcha/messaging
  modules, wiring, hardening, integration verification).
- `APPLICATION_ROADMAP.md` — phased plan for `../application` (Notification infra close-out,
  Watcher domain/persistence/application layers, node-worker command dispatch, the not-yet-built
  `event-consumer`, applicant data encryption, presentation layer, hardening, integration
  verification).

## Conventions for roadmap docs

- One roadmap per part (`application`, `node-worker`, `cita-watcher-docker` if one is ever needed),
  named `<PART>_ROADMAP.md` in SCREAMING_SNAKE_CASE, mirroring the part's own `CLAUDE.md` scope.
- Open with a **Status** line and an explicit list of what's already implemented, so the roadmap
  doesn't get re-derived or contradicted by future reads of the code — link to the part's
  `CLAUDE.md` rather than restating its conventions.
- Break work into numbered `## Phase N — <name>` sections with `- [ ]` checklist items; check items
  off (`- [x]`) as they land instead of deleting them, so the doc stays a record of what happened,
  not just what's planned.
- Cross-reference the other part's roadmap by relative path (`../docs/OTHER_ROADMAP.md`) at any
  point where the two parts share a contract (e.g. the Redis command/event shapes between
  `application` and `node-worker`), rather than duplicating that part's plan here.
- Close with an **Explicit non-goals** section listing what's deliberately out of scope, and where
  that work is actually tracked instead.
- These are living planning documents, not architecture decision records — update them in place as
  scope changes rather than leaving stale phases that no longer reflect the plan.

## Keeping roadmaps in sync

Both roadmaps assume the "Project stage" callouts in the root `CLAUDE.md` and each part's own
`CLAUDE.md` (e.g. "`event-consumer` doesn't exist yet") — if a roadmap phase completes and changes
that stage (a stub gets implemented, a commented-out compose service gets re-enabled), update the
relevant `CLAUDE.md` "Project stage" note in the same change, not just the roadmap checkbox.
