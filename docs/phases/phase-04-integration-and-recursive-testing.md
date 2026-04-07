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
	- `integration/run_golden_thread.py` now emits `integration/last_run.json` with `exit_code` and detailed trace.
	- Local recursive checks passed: backend pytest, frontend lint/smoke, and full golden-thread run against local `uvicorn`.

**Open blocker before formal phase close:**
- The integration workflow file does not yet exist on `origin/main`, so GitHub Actions cannot execute it fully from this feature branch. CI artifact evidence (`integration/run_result.log`, `integration/last_run.json`) on Actions remains pending until workflow is merged to main (or merged via a workflow-only PR).

**Next actions:**
- Merge integration workflow into `main` (or workflow-only PR).
- Trigger integration workflow from Actions and archive artifacts.
- Mark Phase 04 exit criteria complete after CI artifact evidence is recorded.
