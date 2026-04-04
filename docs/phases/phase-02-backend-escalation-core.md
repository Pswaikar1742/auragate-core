# Phase 02: Backend Escalation Core

## Objective
Deliver a reliable FastAPI escalation endpoint that triggers Twilio call flow for timeout events.

## In Scope
- `POST /api/escalate`
- payload validation
- Twilio client integration
- error handling and response structure
- CORS setup for local frontend integration

## Tasks
- [x] Confirm request schema compatibility with frontend payload.
- [x] Confirm required environment variables and error behavior.
- [x] Validate TwiML voice message content.
- [x] Add/maintain health endpoint for diagnostics.
 - [ ] Move `EscalateRequest` model to module scope and validate fields in `backend/main.py`.
 - [ ] Add `POST /api/escalate` documentation to `docs/API_CONTRACT.md`.
 - [ ] Add a smoke-test (curl or pytest) demonstrating a successful and failing escalate call.

## Recursive Test Gates
- Layer 0: syntax compile check
- Layer 1: backend unit checks (if tests exist)
- Layer 2: manual integration POST request with expected payload
- failure loops until pass with documented outcomes

## Exit Criteria
- endpoint returns valid success/error paths
- Twilio call initiation path is functional with configured credentials
- contract docs updated to match runtime behavior

## Progress Notes
- Stateful backend implemented with SQLAlchemy models, PostgreSQL session handling,
  WebSocket manager, and async escalation timer.
- Added endpoints: check-in, approve, guard TOTP, and resident WebSocket channel.
- Contract docs updated for new endpoint set and event schema.
 - Recent fixes: moved `EscalateRequest` Pydantic model to module scope to ensure route validation succeeds and avoid runtime NameErrors.
 - Smoke test: POST `/api/escalate` returns `400` with `{ "detail": "No phone number configured for resident or fallback" }` when `TO_PHONE_NUMBER` or resident phone is not configured; endpoint reachable and error behavior validated.
