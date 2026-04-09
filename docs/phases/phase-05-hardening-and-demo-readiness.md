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
	- Hardened Vercel routing config by removing an explicit empty `routes` override in `vercel.json` so Next.js routes are auto-generated during deployment.
	- Verified deployment URL behavior from CLI: preview deployment is protected (`401 Authentication Required`) and project production alias currently resolves `NOT_FOUND`, so Vercel project-level deployment/alias settings must be finalized.
	- Hardened backend DB startup diagnostics: startup logs now include the underlying DB connectivity error text to speed up Railway/Supabase triage.
	- Hardened Postgres URL normalization to explicitly use `postgresql+psycopg://` so Python 3.13+ runtimes do not rely on `psycopg2` auto-selection.
	- Re-ran recursive checks: backend pytest pass, frontend lint/build/smoke pass, and integration harness trace shows `exit_code: 0` on a clean SQLite verification DB.
	- Added frontend route mapping hardening so app-level navigation is visible even before backend APIs are reachable:
		- added `/resident` index route with flat selection links.
		- added app-level `not-found` page with quick navigation links.
		- updated home page resident entry link to `/resident`.
	- Revalidated frontend checks after route hardening: lint/build/smoke pass.
	- Live deployment verification findings:
		- Railway public domain responds on `/health`, but DB remained disconnected until connection string encoding is corrected.
		- Root cause identified: unencoded `@` in DB password in `DATABASE_URL` breaks host parsing; password must use `%40`.
		- Vercel branch deployment URL is reachable behind deployment protection (`401`), while production alias still returns platform `NOT_FOUND` until alias/production mapping is corrected in Vercel settings.

Remaining Phase-05 focus:
	- Final UI polish pass (visual/state polish, additional friendly guidance).
	- Feature-gap documentation for non-MVP blueprint workflows (multi-flat delivery, scout detection, voice-first capture, SOS override, etc.).
	- Finalize Vercel production alias and deployment protection posture for public demo access.
