# Phase 04: Integration and Recursive Testing

## Objective
Converge frontend and backend into a repeatedly verified end-to-end Golden Thread.

## In Scope
- frontend/backend runtime integration
- timeout to escalation flow validation
- structured recursive test loops and evidence capture

## Tasks
- [x] Execute full Golden Thread scenario repeatedly (local).
- [x] Confirm payload and response schema stability (local harness + API contract alignment).
- [x] Document all failing cases and fixes in state log.
- [x] Add/refresh run commands in docs if changed.

## Recursive Test Gates
- run narrow checks on changed area
- if fail: fix -> rerun narrow checks
- run broad suite (lint/build/integration)
- if fail: fix -> rerun narrow + broad

## Exit Criteria
- at least one clean full-cycle run documented
- no unresolved integration defects for MVP path
- all test evidence recorded

## Progress Notes
- Integration harness scaffolded and repeatedly validated locally.

- Evidence:
	- Added `integration/docker-compose.yml` and `integration/run_golden_thread.py`.
	- Added `.github/workflows/integration.yml` for gated integration harness execution.
	- Fixed workflow bootstrap path on `main` via workflow-only PR + YAML hotfix PR.
	- `integration/run_golden_thread.py` emits `integration/last_run.json` with `exit_code` and detailed trace.
	- Local recursive checks passed: backend pytest, frontend lint/smoke, and full golden-thread run against local `uvicorn`.
	- GitHub Actions integration run completed successfully on PR #3 via `workflow_dispatch`: run `24067695729`, artifacts uploaded as `integration-run-artifacts`.
	- Additional pre-Phase-05 validation sweep passed: live browser guard/resident flow (check-in -> alert -> approve), plus negative-path API checks for missing phone (`400`) and unknown flat (`404`).

**Phase 04 status:**
- Exit criteria satisfied for current MVP Golden Thread.

**Next actions:**
- Move execution focus to Phase 05 hardening and demo readiness increments.
