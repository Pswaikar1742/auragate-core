# AuraGate System Instructions

These are project-level execution rules. Treat them as mandatory.

## Core Rules
- Always run docs-first context load before coding.
- Always work phase-wise (no random cross-phase drift).
- Always execute recursive testing loops for each implementation increment.
- Always update docs at the end of each cycle.

## Docs-First Rule
Before any task execution, read in this order:
1. `docs/SYSTEM_INSTRUCTIONS.md`
2. `docs/README.md`
3. `plan.md`
4. `docs/phases/README.md`
5. active phase file
6. `docs/STATE_LOG.md` latest entry
7. affected technical docs

## Phase Lock Rule
- Every task must map to exactly one active phase.
- If task belongs to another phase, either:
  - queue it in the future phase backlog, or
  - explicitly switch phase and document why.

## Recursive Testing Rule
For each code increment:
1. Run smallest relevant test/check.
2. If fail, fix immediately.
3. Re-run same check.
4. After local pass, run broader suite.
5. If broader suite fails, loop back.

No increment is complete until the recursive loop converges.

## Documentation Rule
After each prompt cycle:
- log summary in `docs/STATE_LOG.md`
- update active phase progress and blockers
- update contract docs when behavior changes

## Traceability Rule
Each state-log entry must include:
- date/time
- phase
- change summary
- tests run and outcomes
- next step
