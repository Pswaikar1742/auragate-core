# Phase 04: Integration and Recursive Testing

## Objective
Converge frontend and backend into a repeatedly verified end-to-end Golden Thread.

## In Scope
- frontend/backend runtime integration
- timeout to escalation flow validation
- structured recursive test loops and evidence capture

## Tasks
- [ ] Execute full Golden Thread scenario repeatedly.
- [ ] Confirm payload and response schema stability.
- [ ] Document all failing cases and fixes in state log.
- [ ] Add/refresh run commands in docs if changed.

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
- Integration harness scaffolded and a first local Golden-Thread run completed.

- Evidence:
	- Added `integration/docker-compose.yml` and `integration/run_golden_thread.py` to the repo.
	- Local narrow loop (frontend build/lint/smoke + backend pytest) passed.
	- Local integration run executed against a local `uvicorn` backend with `IVR_ADAPTER=noop` and produced a successful full-cycle trace; see `docs/STATE_LOG.md` entry for 2026-04-06 (Cycle 14) for exact commands and outputs.

**Next actions:**
- Add a gated CI job to run the integration harness (or start backend in CI) and ensure `IVR_ADAPTER=noop` in CI.
 - Added a gated CI workflow at `.github/workflows/integration.yml` (runs on `workflow_dispatch` or when PR labeled `run-integration`).
 - Enhanced `integration/run_golden_thread.py` to emit `integration/last_run.json` (compact JSON trace) for CI evidence capture.
- Commit and open PR with run evidence and CI plan; iterate on CI failures if any.
