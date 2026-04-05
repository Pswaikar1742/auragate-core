# Phase Playbooks

This folder contains phase-level execution playbooks.

## Active Phase Rule
- Exactly one phase is active at a time.
- Work should map to active phase tasks.
- Crossing phases requires explicit note in `docs/STATE_LOG.md`.

## Phase Files
1. `phase-01-foundation-and-architecture.md`
2. `phase-02-backend-escalation-core.md`
3. `phase-03-frontend-golden-thread-ui.md`
4. `phase-04-integration-and-recursive-testing.md`
5. `phase-05-hardening-and-demo-readiness.md`
6. `phase-06-post-poc-expansion-roadmap.md`

## Per-Phase Required Fields
Each phase file includes:
- objective
- scope
- task list
- test gates
- exit criteria
- progress tracker
