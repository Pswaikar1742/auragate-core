Configuration files in this repository
=====================================

This document lists the configuration and manifest files present in the codebase, explains their purpose, and notes whether they are required for local development, CI, or production deployments (Railway / Supabase / Vercel).

Summary
-------
- Local env samples: `.env.example`, `.env.supabase.example` — useful for developers and CI; do NOT commit real secrets.
- Backend process + build: `backend/Procfile`, `backend/requirements.txt`, `backend/init_db.py`.
- Frontend build & runtime: `frontend/package.json`, `frontend/.eslintrc.json`, `frontend/tsconfig.json`, `frontend/tailwind.config.ts`, `next.config.js`.
- CI/integration: `.github/workflows/ci.yml`, `.github/workflows/integration.yml`.
- Local dev & compose: `docker-compose.yml`, `integration/docker-compose.yml`.

Files and purpose
-----------------

- `.env.example` (root)
  - Purpose: Example environment variables for local development (SQLite fallback, Twilio placeholders, logging level, optional Redis/Neo4j URLs).
  - Necessary: Useful for local dev; NOT used in production. In production, set variables in Railway/Supabase/Vercel dashboard.

- `.env.supabase.example` (root)
  - Purpose: Example values for connecting to a Supabase-hosted Postgres and the public Supabase keys used by the frontend.
  - Necessary: Only for projects using Supabase; keep private credentials out of the repo.

- `backend/Procfile`
  - Purpose: Process start instruction for platform hosts (Heroku/Railway). Current value uses Gunicorn+Uvicorn worker to run `main:app`.
  - Necessary: Recommended for Railway as a conventional start command. Railway will also accept a custom start command in the project settings; either is fine but keep them aligned.

- `backend/requirements.txt`
  - Purpose: Python dependency manifest used by Railway and CI to install backend dependencies (FastAPI, Uvicorn, SQLAlchemy, psycopg2-binary, etc.).
  - Necessary: REQUIRED for backend builds and CI.

- `backend/init_db.py`
  - Purpose: One-off script to create DB tables and seed demo residents. Useful to run after provisioning Postgres in Railway/Supabase.
  - Necessary: Not required by runtime, but required to initialize schema & seed demo rows after provisioning.

- `frontend/package.json`
  - Purpose: Frontend build/start scripts (`build`, `start`, `dev`, `lint`, `smoke`). Used by Vercel and CI.
  - Necessary: REQUIRED for frontend builds.

- `frontend/.eslintrc.json`, `frontend/tsconfig.json`, `frontend/tailwind.config.ts`, `next.config.js`
  - Purpose: Tooling and framework configuration (linting, TypeScript, Tailwind, Next.js runtime). These affect builds and developer tooling.
  - Necessary: Not required at runtime, but required to build the frontend successfully in CI / Vercel / Railway if you run the frontend there.

- `.github/workflows/ci.yml` and `.github/workflows/integration.yml`
  - Purpose: CI/CD and gated integration harness. The CI job installs backend and frontend deps, runs tests, builds the frontend, and optionally runs integration harness.
  - Necessary: Optional for deployment but recommended for automated testing and repeatable DB initialization (see `init-db` workflow in RAILWAY_SETUP.md suggestion).

- `docker-compose.yml` and `integration/docker-compose.yml`
  - Purpose: Local multi-service orchestration for development and integration testing.
  - Necessary: Only for local development or local integration runs.

Notes about `.env` files and production
--------------------------------------
- `.env` (local) files are developer convenience for running the app locally. The repo intentionally includes `.env.example` files and `.gitignore` excludes real `.env` files.
- For production deployments (Railway, Supabase, Vercel) you should set environment variables in the platform's Variables/Secrets UI — do NOT rely on checked-in `.env` files.

Railway-specific observations
----------------------------
- Railway supports a `Procfile` or a custom start command. If you configure a custom start command in Railway settings, it will override the `Procfile` behavior for that service. Keep both consistent to avoid surprises.
- Railway has a "Config-as-code" option — ensure it points to a file that contains deployment config (not an ESLint config). The project's UI screenshot indicated `/frontend/.eslintrc.json` is set as the "Railway Config File"; this is an ESLint config and not a deployment manifest and should be reviewed.

Recommendations
---------------
1. Keep `.env.example` and `.env.supabase.example` in the repo as examples; never commit real credentials.
2. Use Railway/Supabase/Vercel project variables to store `DATABASE_URL`, `TWILIO_*`, `GUARD_TOTP_SECRET`, and other secrets.
3. After adding a DB plugin in Railway or Supabase, run `python -m backend.init_db` once to create tables and seed demo residents (or use the sample GitHub Action in `docs/RAILWAY_SETUP.md`).
4. Verify Railway "Config-as-code" path — point it at a deployment manifest if you want Railway to read deployment rules from repo; do not point it at ESLint config.

Links
-----
- Railway setup guide: [docs/RAILWAY_SETUP.md](RAILWAY_SETUP.md)
