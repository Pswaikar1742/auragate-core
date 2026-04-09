# Phase 05: Hardening and Demo Readiness

## Objective
Prepare a stable and presentation-ready MVP with operational confidence.

## In Scope
- graceful error messaging
- startup runbook for local demo
- secret handling verification
- fallback strategy for external dependency issues

## Tasks
- [x] Validate `.env` handling and secret hygiene.
- [x] Create/verify a quick demo startup checklist.
- [x] Validate behavior when Twilio/env config is missing.
- [ ] Final UI and messaging polish for live demo clarity.

## Recursive Test Gates
- simulate partial failures (missing env, backend unavailable)
- verify clear user feedback and safe behavior
- rerun full happy-path after each fix

## Exit Criteria
- demo can be run from clean machine using docs
- error cases are controlled and documented
- final runbook is complete

## Progress Notes
- Kickoff started with a requirements-vs-code gap assessment using the provided PDF blueprints.
- Current MVP is working for the Golden Thread (guard check-in -> resident WebSocket -> escalation API -> IVR adapter trigger) with local integration evidence.
- Phase-04 CI unblock completed: integration workflow is on `main` and a successful GitHub Actions integration run with artifacts was captured (`run 24067695729`).
- Completed in this increment:
	- Added `docs/DEMO_RUNBOOK.md` with clean-machine setup and validation flow.
	- Explicit secret-hygiene guidance added to runbook (`.env` ignore check + safe demo env setup).
	- Confirmed missing-env behavior for escalation (`400` when no phone fallback) and unknown-flat check-in (`404`).
	- Improved frontend fallback messaging and backend-target visibility in guard/resident screens for demo clarity.
	- Revalidated with checks: backend pytest pass, frontend lint/build/smoke pass, and live browser guard/resident flow pass.
	- Verified backend-down UX behavior in browser: guard shows actionable backend-unreachable message; resident shows disconnected channel target.

Remaining Phase-05 focus:
	- Final UI polish pass (visual/state polish, additional friendly guidance).
	- Feature-gap documentation for non-MVP blueprint workflows (multi-flat delivery, scout detection, voice-first capture, SOS override, etc.).
