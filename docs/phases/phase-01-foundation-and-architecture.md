# Phase 01: Foundation and Architecture Baseline

## Objective
Stabilize project structure, conventions, and environment so all later phases are predictable.

## In Scope
- repository conventions and branching clarity
- docs-first protocol activation
- environment setup sanity checks
- baseline architecture alignment with AuraGate context

## Tasks
- [ ] Confirm branch strategy (`main`, `dev`, feature branches).
- [ ] Verify backend/frontend dependency install paths.
- [ ] Verify docs-first protocol files are present and linked.
- [ ] Ensure `.gitignore` covers local env/secrets/build artifacts.

## Recursive Test Gates
- backend syntax check passes
- frontend lint/build checks pass (if dependencies available)
- docs read order verified by process adherence

## Exit Criteria
- team can cold-start from docs with no hidden tribal context
- environment and docs baseline validated

## Progress Notes
- Initial protocol documents created.
- Remaining baseline checks should be recorded in `docs/STATE_LOG.md`.
