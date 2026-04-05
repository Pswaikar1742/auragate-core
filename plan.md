# AuraGate Project Plan

This file is the top-level execution map for the AuraGate MVP and its immediate evolution.

## Purpose
- Split work into explicit, test-gated phases.
- Enforce phase-wise execution with recursive testing loops.
- Make resume and restart predictable by requiring docs-first context loading.

## Mandatory Read Order Before Any Work
1. `docs/SYSTEM_INSTRUCTIONS.md`
2. `docs/README.md`
3. `plan.md`
4. `docs/phases/README.md`
5. Active phase file in `docs/phases/`
6. `docs/STATE_LOG.md`
7. `docs/API_CONTRACT.md`
8. `docs/AURAGATE_CONTEXT.md`

## Phase Map

| Phase | Name | Goal | Exit Criteria |
| --- | --- | --- | --- |
| 1 | Foundation and Architecture Baseline | Lock structure, env model, and conventions | Branch clean enough to work, docs baseline ready, commands verified |
| 2 | Backend Escalation Core | Reliable FastAPI escalation endpoint with Twilio call path | Endpoint behaves as specified, error paths documented, backend checks pass |
| 3 | Frontend Golden Thread UI | Cyber-dark dashboard + 15s countdown + timeout trigger | UX flow complete, timeout call fires correctly, frontend checks pass |
| 4 | Integration and Recursive Testing | Validate end-to-end behavior repeatedly | Full test loop passes for backend/frontend/integration |
| 5 | Hardening and Demo Readiness | Improve stability, observability, and demo operations | Demo runbook complete, fallback handling documented, dry runs pass |
| 6 | Post-PoC Expansion | Plan near-term scale features | Prioritized roadmap with technical slices and dependency map |

## Phase Files
- See `docs/phases/README.md` for complete phase docs and status protocol.

## Execution Contract
- No code changes before mandatory docs read order is completed.
- Work in the active phase only, unless a blocker requires a temporary support task.
- Every implementation step must run the recursive testing loop defined in `docs/WORKFLOW_PROTOCOL.md`.
- At end of each prompt cycle, update:
  - `docs/STATE_LOG.md`
  - Active phase file progress section
  - Any changed contract doc (`docs/API_CONTRACT.md`, etc.)

## Definition of Done Per Prompt Cycle
- Scope selected from active phase.
- Change implemented.
- Recursive test loop executed and recorded.
- Docs updated with what changed, what passed, and next action.
