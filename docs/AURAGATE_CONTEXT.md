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
- `/backend` — Python FastAPI (business logic, external API triggers, DB access).
- Note: production realtime routing may use Golang WebSockets + Redis.

## 4. Current MVP / Proof of Concept (the "Golden Thread")

We are building the Round‑2 live demo. Focus exclusively on the IVR escalation golden thread — do not implement the full Neo4j or Bhashini integrations for this demo.

MVP flow:

1. Frontend: a React dashboard includes a "Simulate Visitor" button.
2. Clicking the button starts a 15‑second countdown timer in the UI.
3. When the timer reaches `0` the frontend sends a `POST` to the backend.
4. Backend (FastAPI) receives the payload and calls Twilio to initiate an IVR phone call to the resident.
5. Expected outcome: an automated voice call rings the resident's physical mobile number.

## 5. Strict API contract

- **Endpoint:** `POST /api/escalate` (local testing via ngrok is acceptable)

- **Request payload (exact JSON):**

```json
{
  "flat_number": "402",
  "visitor_type": "Delivery",
  "status": "timeout"
}
```

- **Response payload (exact JSON):**

```json
{
  "success": true,
  "message": "IVR Call Triggered to Resident"
}
```

When you generate frontend `fetch`/`axios` calls or backend FastAPI routes, use these exact schemas to ensure interoperability.

## 6. Development protocols

- **Git flow:** `main` (production), `dev` (staging/integration), `feat/*` for feature branches.
- **CORS:** During local hackathon development, enable `CORSMiddleware` to allow all origins (`*`).
- **Environment variables:** Keep Twilio credentials in a local `.env` and never commit them. Required variables:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `MY_VERIFIED_NUMBER`

- **Security note:** Ensure `.env` is listed in `.gitignore` and avoid committing sensitive data.

## 7. Constraints & decisions

- Focus on the IVR escalation golden thread for the demo.
- Keep API contracts minimal and exact.
- Defer full Neo4j / Bhashini implementations until after the demo.

---

**End of context**

