# Demo Runbook (Phase 05)

This runbook is the fastest reproducible path to run AuraGate Golden Thread from a clean machine.

## 1. Prerequisites
- Python 3.11+ and `venv`
- Node.js 20+
- npm
- Git

## 2. Secret Hygiene and Env Setup
1. Confirm `.env` is ignored:
   - `git check-ignore .env`
2. Copy sample env:
   - `cp .env.example .env`
3. Set only local/demo-safe values in `.env`:
   - `DATABASE_URL=sqlite:////tmp/auragate_demo.db`
   - `IVR_ADAPTER=noop`
   - `TO_PHONE_NUMBER=+10000000000`
4. Never commit `.env` or real Twilio credentials.

## 3. Backend Startup
```bash
cd /home/psw/Projects/auragate-core
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
DATABASE_URL=sqlite:////tmp/auragate_demo.db IVR_ADAPTER=noop TO_PHONE_NUMBER=+10000000000 python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
```

Expected health check:
```bash
curl -sS http://127.0.0.1:8001/health
```

## 4. Frontend Startup
```bash
cd /home/psw/Projects/auragate-core/frontend
npm ci
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8001 NEXT_PUBLIC_WS_BASE_URL=http://127.0.0.1:8001 CI=true npm run build
PORT=3001 npm run start -- -p 3001
```

## 5. Validation Sequence
1. Open resident console: `http://localhost:3001/resident/T4-401`
2. Open guard console: `http://localhost:3001/guard`
3. In guard page, enter visitor name and click `Simulate Now`.
4. Verify resident receives `Visitor Alert`.
5. Click `Approve Visitor` and verify status updates.

## 6. Integration Harness (Optional but Recommended)
```bash
cd /home/psw/Projects/auragate-core
source .venv/bin/activate
GOLDEN_THREAD_BASE=http://127.0.0.1:8001 python integration/run_golden_thread.py
cat integration/last_run.json
```

## 7. Negative-Path Checks
- Missing phone fallback:
  - Run backend without `TO_PHONE_NUMBER` and call `/api/escalate`.
  - Expected: HTTP `400` with `No phone number configured for resident or fallback`.
- Unknown flat check-in:
  - Call `/api/visitors/check-in` with unknown `flat_number`.
  - Expected: HTTP `404` with `No resident found for flat ...`.

## 8. Shutdown
- Stop backend and frontend processes with `Ctrl+C`.
- Optional cleanup:
```bash
rm -f /tmp/auragate_demo.db
```
