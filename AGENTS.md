# AuraGate Agent Instructions

This repository uses a docs-first execution model.

## Mandatory Behavior
- Before any implementation, read in order:
  1. `docs/SYSTEM_INSTRUCTIONS.md`
  2. `docs/README.md`
  3. `plan.md`
  4. `docs/phases/README.md`
  5. active phase file
  6. `docs/STATE_LOG.md`
  7. impacted technical docs

- Execute work phase-wise only.
- Run recursive testing loops for each increment.
- Update docs at end of each prompt cycle.

## Prompt Cycle Contract
1. Intake prompt and map to one active phase.
2. Implement smallest possible change.
3. Run recursive tests (narrow -> broad; fail loops until pass).
4. Update:
   - `docs/STATE_LOG.md`
   - active phase progress notes
   - affected contract docs

## Start Modes
- For resume mode: follow `docs/PROMPT_PROTOCOL.md` Resume Protocol.
- For cold start mode: follow `docs/PROMPT_PROTOCOL.md` Cold Start Protocol.
