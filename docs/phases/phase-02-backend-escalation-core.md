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
