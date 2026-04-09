Railway deployment and setup guide
================================

This document lists recommended steps to configure Railway (or use Supabase) and deploy the AuraGate backend.

Prerequisites
-------------
- Railway account (https://railway.app) or Supabase account (https://supabase.com).
- GitHub repository connected (recommended) so Railway can auto-deploy on merges to `main`.
- `railway` CLI (optional) if you prefer CLI-based setup.

High-level steps
-----------------
1. Push your feature branch and open a PR (already done). Merge into `main` to trigger CI / auto-deploy.
2. In Railway, create a new project (or reuse an existing one) and connect the repository.
3. Add a PostgreSQL plugin (Railway) or provide your Supabase connection string as `DATABASE_URL`.
4. Add required environment variables for safe first deploy.
5. Optionally run DB initialization after the Postgres add-on is provisioned.

Environment variables (recommended)
-----------------------------------
Set the following variables in Railway (Project Settings -> Variables) or via the CLI:

- `DATABASE_URL` — your Postgres connection string. If using Supabase, copy the DB URL from the Supabase project.
- `AURAGATE_REQUIRE_DB_ON_STARTUP` — set to `false` for the first deploy so the service does not fail if the DB is still provisioning. Set to `true` later.
- `IVR_ADAPTER` — set to `noop` during initial deploy to avoid sending real IVR/Twilio calls while you validate the service.
- `TO_PHONE_NUMBER` — optional demo phone number used when seeding demo residents.
- `GUARD_TOTP_SECRET` — optional secret; the app will generate one if unset.
- `LOG_LEVEL` — e.g., `INFO` or `DEBUG` for troubleshooting.

Notes on Supabase
------------------
- Supabase provides a Postgres connection string which you can use directly as `DATABASE_URL`.
- Ensure SSL mode is enabled in the connection string if required by your client (Supabase usually provides the correct URL including `sslmode=require`).

Recommended Railway UI steps
----------------------------
1. Create or select a project in Railway.
2. Go to "Plugins/Add-ons" and provision a PostgreSQL database.
3. Copy the generated connection string and set it in "Variables" as `DATABASE_URL`.
4. Add the other variables shown above (`AURAGATE_REQUIRE_DB_ON_STARTUP=false`, `IVR_ADAPTER=noop`, etc.).
5. Under the "Deployments" tab, connect your GitHub repo and enable automatic deploys from `main` (or trigger a manual deployment).

CLI-friendly commands (optional)
--------------------------------
If you have the Railway CLI installed and prefer to use it, the typical flow looks like:

```bash
# login once
railway login

# create or link project (follow interactive prompts)
railway init

# (Optional) set variables via CLI
railway variables set DATABASE_URL="<your-db-url>"
railway variables set AURAGATE_REQUIRE_DB_ON_STARTUP=false
railway variables set IVR_ADAPTER=noop

# Trigger a deploy (if your repo is linked)
railway up
```

Initializing the database
-------------------------
After the Postgres plugin is provisioned and the `DATABASE_URL` variable is set, initialize the DB schema and seed demo residents once:

```bash
# from repository root (ensure virtualenv and dependencies installed)
python -m backend.init_db
```

The repository also contains a `Procfile` configured for production using Gunicorn and the `requirements.txt` lists `gunicorn` and `psycopg2-binary` for Postgres support.

Troubleshooting
---------------
- If the service fails to start because the DB is not ready, ensure `AURAGATE_REQUIRE_DB_ON_STARTUP` is set to `false` for your first deploy. Once the DB is available, run the init script and then set the variable to `true` to enforce DB availability on startup.
- For Supabase, confirm the `DATABASE_URL` includes SSL settings if required.

Next steps for me
-----------------
- If you want, I can attempt to run Railway CLI commands here if you provide a temporary Railway token (not recommended over chat).
- Otherwise I can prepare a deployment checklist, add CI job to initialize the DB automatically after the addon is created, or wire up a GitHub Action to run `python -m backend.init_db` once the `DATABASE_URL` is present.
