# Workflow Protocol (Phase-Wise with Recursive Testing)

## Protocol Objective
Provide a repeatable execution engine for AuraGate where each phase is completed through tested increments.

## Phase-Wise Execution Loop

```
for phase in ordered_phases:
    load_docs_context()
    while not phase_exit_criteria_met:
        pick_smallest_next_task()
        implement_change()
        recursive_test_loop()
        update_docs_and_state()
```

## Recursive Test Loop (Mandatory)

```
def recursive_test_loop():
    run_narrow_checks()
    while failures_exist:
        debug_and_fix()
        rerun_narrow_checks()

    run_broader_suite()
    while broader_failures_exist:
        debug_and_fix()
        rerun_relevant_narrow_checks()
        rerun_broader_suite()

    record_passing_evidence()
```

## Test Layers
- Layer 0: Static and syntax checks.
- Layer 1: Unit-level checks for changed logic.
- Layer 2: Integration checks across frontend/backend contracts.
- Layer 3: End-to-end scenario for the Golden Thread demo.

## Suggested Command Matrix

### Backend (FastAPI)
- Syntax: `python -m py_compile backend/main.py`
- Unit tests (when present): `pytest backend/tests -q`
- Local run: `uvicorn backend.main:app --reload --port 8000`

### Frontend (Next.js)
- Lint: `npm run lint`
- Build: `npm run build`
- Local run: `npm run dev`

### Integration
- Manual API probe: `POST /api/escalate` with contract payload.
- Golden Thread run: simulate visitor -> countdown -> escalation call attempt.

### Manual API Probe Examples
Use these quick curl examples for smoke testing the escalation path.

1) Validate endpoint reachable and error behavior when no routing phone is configured:

```bash
curl -sS -X POST -H "Content-Type: application/json" \
    -d '{"flat_number":"T4-401","visitor_type":"Delivery"}' \
    http://localhost:8000/api/escalate
# Expected: 400 with JSON {"detail":"No phone number configured for resident or fallback"}
```

2) Example (when `TO_PHONE_NUMBER` or resident phone is configured):

```bash
curl -sS -X POST -H "Content-Type: application/json" \
    -d '{"flat_number":"T4-401","visitor_type":"Delivery"}' \
    http://localhost:8000/api/escalate
# Expected: {"success": true, "message": "IVR Call Triggered to Resident"} OR a failure message if Twilio credentials missing
```

## Evidence Requirements
A cycle is valid only if docs capture:
- what changed
- what tests ran
- pass/fail details
- unresolved blockers
- next action

## Failure Policy
- Never stack unrelated changes while tests are red.
- Fix nearest failing check first.
- Do not proceed to next phase with unresolved current-phase blockers unless explicitly documented as deferred.
