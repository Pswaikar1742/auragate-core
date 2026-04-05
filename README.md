# AuraGate: Context-Aware, Zero-Friction Gate Security
![AuraGate Architecture](/home/psw/Projects/auragate/auragate-core/system_architecture.png)

**AuraGate** is a full-stack, AI-driven visitor and resident security platform designed for gated communities. It moves beyond simple "digital logbooks" to create a proactive security engine that fixes the fundamental flaws in existing systems: guard cognitive overload, resident notification fatigue, and static security vulnerabilities.

**Project Status:** 🏆 **Round 1 Winner at Quantum Hacks 2026**. Currently developing a Proof of Concept (PoC) for our Round 2 presentation.

---

## 📘 Execution Protocol (Docs-First)
All implementation must follow the repository docs protocol before coding.

**Read order for every prompt cycle:**
1. `docs/SYSTEM_INSTRUCTIONS.md`
2. `docs/README.md`
3. `plan.md`
4. `docs/phases/README.md`
5. Active phase file
6. `docs/STATE_LOG.md`
7. `docs/API_CONTRACT.md` and `docs/AURAGATE_CONTEXT.md` as needed

For full process details, see:
- `docs/WORKFLOW_PROTOCOL.md`
- `docs/PROMPT_PROTOCOL.md`

---

## 🎯 The Core Problem
Traditional gate security apps fail in three key areas of Indian ground reality:
1.  **Friction & Speed:** Forcing gig workers into slow, humiliating AI scans causes massive gate traffic jams and frustrates delivery partners.
2.  **Human Error:** Low-literacy guards typing visitor names on English keyboards leads to unusable logs and long queues.
3.  **The "Silent Phone" Flaw:** Residents with their phones on Do Not Disturb (DND) or asleep miss critical entry notifications, leaving visitors stranded.

## ✨ Our Solution: The 4 Pillars of AuraGate
AuraGate replaces blanket friction with Context-Aware intelligence and robust failsafe mechanisms.

| Pillar                        | Technology                                     | Solves                                                                   |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| **1. Context-Aware Friction** | MediaPipe (Edge AI) & Tesseract.js (Edge OCR)  | *Delivery Agents* use fast OCR on packages; *Strangers* get a secure liveness selfie. |
| **2. Voice-First Guard UI**     | Bhashini API (Speech-to-Text)                  | Eliminates guard typing, supports regional languages, and reduces data entry errors. |
| **3. Omni-Channel Escalation**| Go WebSockets, Redis Timer, Twilio IVR API     | Bypasses DND mode by triggering an automated phone call if the app is ignored. |
| **4. Proactive Anomaly Detection**| Neo4j Graph Database & TOTP Cryptography     | Catches "scouts" using fake aliases and prevents screenshot-based QR spoofing. |

---

## 🛠️ System Architecture & Tech Stack

Our system is designed as a scalable, event-driven microservice architecture to ensure high availability and real-time performance.

*   **Frontend (UI/UX):** Next.js (Admin Analytics Dashboard), React Native (Resident/Guard App).
*   **Real-Time Router (Nervous System):** Go (Golang) WebSockets for zero-latency bi-directional routing, Redis Pub/Sub for timers and message queuing.
*   **AI & Logic Engine (The Brain):** Python (FastAPI) for business logic, Identity Collision checks, and triggering external APIs.
*   **Databases (The Memory):** Neo4j (Graph Database for Scout Detection) and PostgreSQL (for encrypted, searchable audit logs).
*   **External APIs:**
    *   **Bhashini:** For regional language Speech-to-Text.
    *   **Twilio/Exotel:** For automated IVR phone call escalations.

---

## 🚀 Project Roadmap & MVP

Our immediate focus is on developing a **Proof of Concept (PoC)** for the Round 2 presentation.

### Round 2 PoC: The "Golden Thread"
The PoC will demonstrate our most critical user-facing feature: the **Omni-Channel Escalation**.
*   **Objective:** To showcase a live demo where a simulated visitor triggers a notification, a 15-second timer runs out, and a **Twilio-powered IVR call** is successfully made to a physical phone, bypassing its "Do Not Disturb" mode.
*   **Status:** In Progress.

### Local Quickstart: Escalation smoke test

Use these steps to run a minimal local smoke test for the escalation endpoint.

1. Start a local Postgres instance (docker required):

```bash
docker compose up -d postgres
```

2. Activate the Python virtualenv and run the backend:

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

3. Run a smoke POST to `/api/escalate`:

```bash
curl -sS -X POST -H "Content-Type: application/json" \
    -d '{"flat_number":"T4-401","visitor_type":"Delivery"}' \
    http://localhost:8001/api/escalate
```

Expected outcomes:
- If `TO_PHONE_NUMBER` (or a resident phone) is not configured, the endpoint returns `400` with a JSON payload: `{ "detail": "No phone number configured for resident or fallback" }`.
- If `TO_PHONE_NUMBER` and Twilio credentials are configured, the endpoint attempts to place an IVR call and returns `{ "success": true, "message": "IVR Call Triggered to Resident" }` on success (or a failure message if Twilio errors).

Environment variables: see `.env.example` for the full list. Set `TO_PHONE_NUMBER` to a reachable phone in E.164 format (e.g. `+919876543210`) to test call routing.

### Future Scope
*   **Phase 1:** Full Bhashini API and Neo4j integration.
*   **Phase 2:** ANPR (Automatic Number Plate Recognition) for automated vehicle entry.
*   **Phase 3:** Direct API handshake with Zomato/Swiggy servers for GPS-based auto-entry.

---

## ⚖️ Compliance & Governance
AuraGate is engineered with a "Privacy by Design" philosophy to adhere to the highest standards of data protection.

*   **DPDP Act 2023 Compliant:** We utilize Zero-Trust Number Masking (guards never see resident PII) and implement a 48-hour auto-purge policy for sensitive visitor data like selfies.
*   **Zero-Trust Architecture:** Aligns with NIST SP 800-207 principles, using TOTP cryptography for visitor passes to eliminate man-in-the-middle and replay attacks.

---

## 👥 Team
*   **Prathmesh Waikar :** Product & Strategy
*   **Mohammad Syed Ali :** Backend & AI/Security
*   **Shreyas Mudholkar :** UI/UX & Frontend
