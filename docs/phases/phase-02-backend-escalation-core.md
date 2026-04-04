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
 - [x] Add a smoke-test (curl or pytest) demonstrating a successful and failing escalate call.

## Recent Work
- Added `backend/tests/test_escalate.py` implementing pytest smoke tests for `/api/escalate` covering:
    - failing case: no phone configured → expect HTTP 400 with documented detail
    - success case: mocked Twilio call returns dummy SID → expect HTTP 200 success

Notes: tests are designed to run against a local SQLite test database and mock the Twilio call path to avoid network traffic.

## Twilio Issues & Alternatives

Twilio-related behavior observed during smoke tests was a symptom of a local SQLite file-permission issue (a `readonly database` error) rather than an explicit Twilio network failure. Still, CI or restricted environments may prevent live Twilio calls. Consider these alternatives when Twilio is unavailable or unsuitable for CI tests:

- **Twilio Test Credentials / Magic Numbers:** Use Twilio's test credentials and magic numbers to simulate call and SMS outcomes without performing live network calls.
- **Keep Mocking in Tests:** Continue to mock the `_trigger_twilio_call` call in unit/integration tests to validate behavior without network dependencies.
- **Adapter Pattern / Provider Swap:** Implement an `IVRAdapter` interface and support alternative providers (Telnyx, SignalWire, Bandwidth, Plivo). Most providers offer Python SDKs and similar IVR capabilities.
- **Local PBX for Full Control:** For end-to-end testing, use Asterisk or FreeSWITCH (higher setup/maintenance cost, but no external dependency).
- **Emulated Webhooks / Stub Server:** Run a local stub of the Twilio webhook API (or use `ngrok`) to exercise end-to-end flows without using production credentials.

## Recommended Next Steps (Phase 02)

1. Keep the test-suite mocking Twilio for CI runs and verify call invocation via assertions (already implemented in `backend/tests/test_escalate.py`).
2. Make DB test paths robust: use pytest `tmp_path` or an explicit `/tmp` file-based SQLite URL to avoid permission issues in CI runners.
3. Add a small `IVR_ADAPTER` abstraction so providers are swappable and tests can inject a `noop_adapter` or a `test_adapter`.
4. For manual integration verification, use Twilio test credentials or a short SignalWire/Telnyx trial account from a writable environment.
5. Document the chosen approach in `docs/STATE_LOG.md` and in this phase file for traceability.

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
