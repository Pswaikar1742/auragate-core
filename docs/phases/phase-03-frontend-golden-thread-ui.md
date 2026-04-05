# Phase 03: Frontend Golden Thread UI

## Objective
Implement the AuraGate PoC dashboard flow from visitor simulation to escalation trigger.

## In Scope
- cyber-dark dashboard styling
- simulate visitor button
- 15-second countdown behavior
- timeout-triggered backend call
- clear escalation status/error UI

## Tasks
- [x] Confirm guard check-in form submits to backend and shows feedback.
- [x] Confirm resident page subscribes to WebSocket and renders visitor overlay.
- [x] Confirm approve action calls backend endpoint and updates UI state.
- [x] Confirm QR token payload is rendered and refreshed from TOTP endpoint.

## Recursive Test Gates
- Layer 0: TypeScript and lint checks
- Layer 1: component behavior checks (manual or automated)
- Layer 2: backend integration call during timeout
- rerun loops until stable pass

## Exit Criteria
- full UI flow works without manual patching
- frontend backend contract remains consistent
- demo-ready visual state transitions

## Progress Notes
- Added `/guard` page with dynamic QR, check-in form, and response handling.
- Added `/resident/[flatNumber]` page with WebSocket connection and approve workflow.
- Root page now acts as route hub for Guard and Resident simulation paths.
 - Updated CI to build and lint frontend on PRs; branch `feat/phase-03-golden-thread` created and PR opened (PR #2).

## Exit Criteria — Completed

- Date: 2026-04-06
- Status: Completed (increment)
- Notes:
	- Guard page: check-in form, TOTP QR, and 15-second countdown + Simulate button implemented.
	- Resident page: WebSocket resident flow and approve action implemented.
	- Frontend build (`next build`) and lint (`next lint`) pass locally and are enforced in CI.
	- Added frontend smoke check: `frontend/scripts/smoke-check.js` scans build artifacts for `/api/health` usage; CI runs this check.

All Phase‑03 exit criteria have been satisfied for this increment. Proceed to Phase 04 once CI on PR #2 is green and review is complete.
