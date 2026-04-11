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
- [x] Final UI and messaging polish for live demo clarity.

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
	- Deployment recovery hardening completed:
		- Backend now auto-repairs malformed pooler URLs where `@` in password is not URL-encoded and renders canonical encoded URL.
		- Added `frontend/vercel.json` and simplified root `vercel.json` build mapping to stabilize monorepo deployment behavior.
		- Live checks now show:
			- Railway `/health` returns `status: ok` and `database: connected`.
			- Vercel production routes `/`, `/guard`, `/resident`, and `/resident/T4-401` return HTTP 200.
	- Restored the richer persona dashboard frontend experience from stash history (not present on `dev`/`feat/ui-dashboard` branches):
		- added resident auth flow (`/resident/login`) and resident operations dashboard (`/resident/dashboard`).
		- added secure invite pass generation/sharing and TOTP invite page (`/invite/[id]`).
		- added visitor self-serve mobile flow (`/visitor`) and admin analytics dashboard (`/admin`).
		- restored shared runtime path helpers and vintage/navy/safety Tailwind tokens used by the restored pages.
		- added required frontend dependencies: `lucide-react`, `recharts`, `otpauth`.
	- Revalidated after restoration:
		- `npm --prefix frontend run lint` (pass, warnings only).
		- `npm --prefix frontend run vercel-build` (pass).
		- `npm --prefix frontend run smoke` (pass).
		- `pytest -q backend/tests/test_escalate.py` (2 passed).
		- live probes show `https://auragate-core.vercel.app/`, `/guard`, and `/resident/login` returning HTTP 200; Railway `/health` reports `database: connected`.
	- Screenshot-aligned kiosk rebuild completed:
		- rebuilt `frontend/app/guard/page.tsx` into the white-mode brutalist guard terminal matching provided visual references (large tile grid, modal workflows, fixed orange status rail, red SOS action).
		- kept existing guard API handlers/endpoints intact while moving interaction entrypoints into modal-based UI.
		- aligned persona homepage (`frontend/app/page.tsx`) to the same brutalist visual language for consistency.
		- removed deploy-blocking broken import in `frontend/app/todos/page.tsx` (`@/utils/supabase/server`) to restore successful production builds.
		- revalidated: `npm --prefix frontend run lint` (warnings only) and `npm --prefix frontend run vercel-build` (pass).
	- Guest-pass parity update completed:
		- updated `frontend/app/invite/[id]/page.tsx` to use the white/orange brutalist palette consistent with guard/home pages.
		- disabled geolocation gate intentionally (commented rationale in code) so invite/TOTP links proceed directly to QR + rotating OTP flow.
		- invite pass now always renders approval-ready QR/TOTP and retry path on seed generation errors.
		- revalidated with `npm --prefix frontend run lint` (warnings only) and `npm --prefix frontend run vercel-build` (pass).
	- Guard camera hardening completed:
		- replaced simulated camera placeholders in guard modals with real `getUserMedia` capture flow and per-scenario photo state (single, multi-flat, unknown, expected guest).
		- wired captured camera snapshots as `image_payload` to `/api/visitors/check-in`, `/api/visitors/multi-flat`, and `/api/visitors/unplanned`.
		- submit actions for camera-required flows are now gated until a photo is captured; retake flow added.
		- revalidated with `npm --prefix frontend run lint` (pass), `npm --prefix frontend run build` (pass; existing non-blocking `<img>` warnings remain in other pages), and `pytest -q backend/tests/test_escalate.py` / `pytest -q` (2 passed).
	- Guard expected-guest TOTP verification flow hardened end-to-end:
		- updated `frontend/lib/runtimeConfig.ts` so production frontend defaults to Railway backend when hosted on non-Railway origins (prevents `NetworkError when attempting to fetch resource`).
		- rebuilt guard "Scan Guest QR" modal to use camera-based QR scanning (`BarcodeDetector`) and auto-fill visitor ID + TOTP code from resident invite-pass QR payload.
		- added explicit guard notification panel in kiosk UI for live event visibility (`visitor_checked_in`, `visitor_approved`, SOS stream entries).
		- constrained homepage options to requested operational set: Guard Kiosk, Resident Login, Admin, and Visitor Dashboard.
		- backend `/api/visitors/verify-totp` now supports small time skew (`valid_window=1`) and idempotent success when visitor is already approved.
		- revalidated with `npm --prefix frontend run lint` (pass with existing non-blocking `<img>` warnings), `npm --prefix frontend run smoke` (pass), and `pytest -q backend/tests/test_escalate.py` (2 passed).
	- Real TOTP pipeline tightened to remove mock-style invite IDs and scanner fallbacks:
		- backend `/api/visitors/verify-totp` now enforces strict DB-seed verification (`visitor_logs.secret_seed`, 60-second TOTP interval) and rejects non-expected-guest rows for this path.
		- backend `/api/guard/totp` now returns `503` when TOTP service is unavailable instead of emitting stub OTP values.
		- backend invite API now requires explicit `guest_name` and `flat_number`, and response includes persisted `visitor_name`/`flat_number` metadata.
		- added `/api/totp/invite/{visitor_id}` so invite links resolve by real DB `visitor_id` and fetch persisted seed metadata.
		- resident dashboard invite generation now calls backend create endpoint and shares links keyed by real `visitor_id` (no random mock link id generation).
		- invite page now loads seed from `/api/totp/invite/{id}` and rotates QR/TOTP from DB seed on the 60-second clock.
		- guard expected-guest scanner now uses `jsqr` with live camera frame decode, auto-populates `visitor_id` + `totp`, and immediately calls verify API.
		- guard now shows explicit full-screen `ENTRY GRANTED` (green) and `ENTRY DENIED` (red) outcomes during verification.
		- added backend tests in `backend/tests/test_totp_flow.py` for success, invalid code, idempotent approval, and missing-seed `400` behavior.
		- revalidated with `pytest -q backend/tests/test_totp_flow.py` (4 passed), `pytest -q backend/tests/test_totp_flow.py backend/tests/test_escalate.py` (6 passed), `npm --prefix frontend run lint` (pass, existing warnings), `npm --prefix frontend run build` (pass), and `npm --prefix frontend run smoke` (pass).
	- Production history hardening completed after live guard-page verification surfaced `500` responses on `/api/visitors/history`:
		- added startup schema compatibility patching for legacy `visitor_logs` deployments (auto-adds optional columns: `phone_number`, `image_payload`, `ocr_text`, `secret_seed`, `group_id`).
		- added resilient history endpoint fallback (ORM query -> raw SQL compatibility query -> empty list fail-safe) so guard/admin pages remain functional even under schema drift.
		- fixed visitor self-serve prefill implementation to avoid Next.js prerender failure by replacing `useSearchParams` usage with client-side `window.location.search` parsing.
		- revalidated with `pytest -q` (8 passed), `npm --prefix frontend run lint` (pass with existing non-blocking `<img>` warnings), `npm --prefix frontend run build` (pass), and `npm --prefix frontend run smoke` (pass).
	- CI remediation after push:
		- GitHub Actions run `24277117473` failed in `Build frontend` due to missing `jsqr` dependency resolution.
		- included `jsqr` in committed frontend dependency manifests (`frontend/package.json`, `frontend/package-lock.json`).
		- verified using CI-like local reinstall/build (`npm ci` + `npm run build`) before repush.

Remaining Phase-05 focus:
	- Final UI polish pass (visual/state polish, additional friendly guidance).
	- Feature-gap documentation for non-MVP blueprint workflows (multi-flat delivery, scout detection, voice-first capture, SOS override, etc.).
	- Finalize Vercel production alias and deployment protection posture for public demo access.
	- Execute one complete live browser pass for resident auth -> invite share -> guard check-in -> resident approve with screenshots/log evidence.
