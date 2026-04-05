# Prompt Protocol

This protocol defines how each new prompt is processed.

## 1. Cold Start Protocol (Start From Scratch)
Use when context is uncertain or environment was reset.

Checklist:
- Read required docs in order (see `docs/README.md`).
- Verify current branch and git status.
- Rebuild/activate environments.
- Run baseline checks (backend syntax + frontend lint/build if available).
- Re-identify active phase and next smallest task.
- Execute work using recursive testing loop.
- Update docs and state log.

## 2. Resume Protocol (Continue Existing Work)
Use when prior context exists.

Checklist:
- Read `docs/STATE_LOG.md` latest entry.
- Confirm active phase and pending item from phase file.
- Validate branch and uncommitted changes.
- Execute one scoped increment.
- Run recursive testing loop.
- Update docs and next action.

## 3. End-of-Prompt Protocol
Before ending any cycle:
- confirm tests/checks run for changed scope
- update active phase progress notes
- append state-log entry
- update any changed contracts or architecture docs
- define next immediate task

## 4. Prompt Intake Classification
For each incoming prompt, classify into one:
- planning/documentation
- backend implementation
- frontend implementation
- integration/testing
- demo readiness/hardening

Then map it to exactly one active phase.
