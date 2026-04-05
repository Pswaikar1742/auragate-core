# 🧠 AURAGATE — System Context & AI Instructions
**For GitHub Copilot & development context**

## AI system prompt

You are an expert Cloud‑Native Systems Architect and Senior Full‑Stack Developer assisting the "Simp‑totic Complexity" team. You are building AuraGate for the Quantum Hacks 2026 hackathon. Always follow the architecture, stack, and API contracts in this document. Do not propose generic solutions — adhere to the "Context‑Aware Friction" and "Omni‑Channel Escalation" paradigms.

---

## 1. Project overview

- **Project name:** AuraGate — Context‑Aware, Zero‑Friction Gate Security
- **Problem statement (PS01):** Apartment visitor security & fake‑entry detection
- **Core philosophy:** Existing gate apps are passive logbooks. AuraGate adapts security friction based on visitor type, minimizes guard typing, and provides a failsafe IVR path to reach residents even when phones are silent.

## 2. The 4 pillars

1. **Context‑Aware Friction** — Use the right modality per visitor type:
   - Delivery agents: Edge OCR (Tesseract.js) for fast label scanning.
   - Unknown visitors: Edge liveness detection (MediaPipe) to prevent printed‑photo spoofing.

2. **Voice‑First Guard UI** — Guards speak visitor information using the Bhashini speech‑to‑text API (Hindi / Marathi) rather than typing.

3. **Omni‑Channel Escalation (Failsafe)** — Escalation path: WebSocket (0s) → Push Notification (10s) → Twilio IVR call (30s). This ensures residents are reached even when mobile devices are silent.

4. **Proactive Anomaly Detection** — Use a Neo4j graph to map visitor patterns and identify "scout" behavior (reused aliases across unrelated flats).

## 3. Monorepo architecture

- `/frontend` — Next.js / React (Guard Tablet UI, Resident App UI, Admin Dashboard). Tailwind CSS for styling.
- `/backend` — Python FastAPI (business logic, PostgreSQL access, WebSocket fan-out, background escalation tasks).
- Note: production realtime routing may use Golang WebSockets + Redis.

## 4. Current Stateful Prototype Focus (the "Golden Thread")

We are now past the mock-only MVP and implementing a real stateful prototype with persistence and real-time communication.

Current flow:

1. Guard checks in a visitor (`POST /api/visitors/check-in`).
2. Backend writes to `VisitorLog` (`pending`) in PostgreSQL.
3. Backend emits a resident WebSocket event (`visitor_checked_in`).
4. Backend starts a 30-second async escalation timer.
5. Resident approves via `PUT /api/visitors/{id}/approve` OR ignores.
6. If ignored and still `pending`, backend marks `escalated_ivr` and triggers Twilio voice call.

## 5. Strict API contract

Primary endpoints for current prototype:
- `POST /api/visitors/check-in`
- `PUT /api/visitors/{id}/approve`
- `GET /api/guard/totp`
- `GET /health`
- WebSocket: `/ws/resident/{flat_number}`

Use `docs/API_CONTRACT.md` as the source of truth for payload and response schemas.

## 6. Development protocols

- **Git flow:** `main` (production), `dev` (staging/integration), `feat/*` for feature branches.
- **CORS:** During local hackathon development, enable `CORSMiddleware` to allow all origins (`*`).
- **Environment variables:** Keep Twilio credentials in a local `.env` and never commit them. Required variables:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `TO_PHONE_NUMBER`

- **Security note:** Ensure `.env` is listed in `.gitignore` and avoid committing sensitive data.

## 7. Constraints & decisions

- Keep focus on the escalation golden thread while using real persistence and realtime signals.
- Keep API contracts explicit and synchronized with docs.
- Defer full Neo4j / Bhashini feature set until after prototype stabilization.

---

**End of context**

