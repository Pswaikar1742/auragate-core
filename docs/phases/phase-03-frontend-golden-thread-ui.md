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
