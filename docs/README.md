# AuraGate Documentation Operating Manual

This folder is the source of truth for how work is executed, tested, and documented.

## What This Folder Solves
- Prevents context loss between prompts.
- Enforces phase-wise execution.
- Forces recursive testing instead of one-shot validation.
- Makes resume and restart deterministic.

## Mandatory Start Sequence (Every Prompt)
1. Read `docs/SYSTEM_INSTRUCTIONS.md`.
2. Read `plan.md`.
3. Read `docs/phases/README.md` and identify active phase.
4. Read active phase file.
5. Read `docs/STATE_LOG.md` latest entry.
6. Read impacted technical docs (`docs/API_CONTRACT.md`, `docs/AURAGATE_CONTEXT.md`).
7. Then execute implementation/testing.

## If Starting From Scratch
- Follow `docs/PROMPT_PROTOCOL.md` section "Cold Start Protocol".
- Rebuild local env.
- Re-run baseline checks.
- Recreate current state from docs before writing code.

## If Continuing Existing Work
- Follow `docs/PROMPT_PROTOCOL.md` section "Resume Protocol".
- Validate phase and pending tasks.
- Execute only next scoped increment.

## Required End-of-Cycle Updates
At the end of every prompt cycle, update at minimum:
- `docs/STATE_LOG.md`
- active phase file progress notes in `docs/phases/`
- any changed contract/architecture doc

## Document Index
- `docs/SYSTEM_INSTRUCTIONS.md`: hard rules and behavior contract.
- `docs/WORKFLOW_PROTOCOL.md`: recursive phase execution and test loops.
- `docs/PROMPT_PROTOCOL.md`: prompt-level start/resume/end checklists.
- `docs/STATE_LOG.md`: chronological execution memory.
- `docs/IMPLEMENTATION_STATUS.md`: implemented vs pending feature/workflow matrix.
- `docs/DEMO_RUNBOOK.md`: clean-machine startup and demo verification checklist.
- `docs/phases/`: phase playbooks and acceptance gates.
- `docs/API_CONTRACT.md`: API definitions and examples.
- `docs/AURAGATE_CONTEXT.md`: product and architecture context.
