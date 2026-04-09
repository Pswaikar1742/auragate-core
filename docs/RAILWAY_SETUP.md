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
- If startup logs show `Network is unreachable` when connecting to a `db.<project>.supabase.co` host, switch to Supabase's connection pooler URL (IPv4-friendly) from Supabase -> Connect -> Connection Pooling and use that as `DATABASE_URL`.

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

Railway service config parsing errors
------------------------------------
If you see an error like:

> Failed to parse your service config. `buildCommand` and `startCommand` cannot be the same.

This usually means the Railway "Build & Run" settings (or your "Config-as-code" file) set both commands to the same value. Fix it in one of these ways:

- Railway UI (recommended):
	1. Open your Railway project → "Deployments" → click the failing service → "Settings" or "Build & Run".
	2. Remove the `buildCommand` (Python backend typically does not need one) or set it to a distinct build step.
	3. Set the `startCommand` to the production start command for the backend. Example (matches `backend/Procfile`):

		```bash
		# recommended: import the app as a package
		gunicorn -k uvicorn.workers.UvicornWorker backend.main:app -b 0.0.0.0:$PORT --log-level INFO
		```

		Note: If you use `backend.main:app`, ensure `backend/__init__.py` is present and
		committed so Python recognizes `backend/` as a package. Alternatively, you can
		keep a top-level `main.py` and use `main:app`, but package-style imports are
		recommended for clarity in multi-module repos.

	4. Save and redeploy.

- If you use Railway "Config-as-code":
	- Ensure the configured file path points to a valid deployment manifest (not an ESLint config or unrelated file).
	- Edit the manifest so `startCommand` is the server start command above and either remove `buildCommand` or make it different from `startCommand`.

- Single-repo with multiple services:
	- Create one Railway service per component (backend and frontend) and configure each service's build/start commands separately to avoid collisions.

After these changes, restart the deployment and check the logs — the duplicate-command parse error should be resolved.

Next steps for me
-----------------
- If you want, I can attempt to run Railway CLI commands here if you provide a temporary Railway token (not recommended over chat).
- Otherwise I can prepare a deployment checklist, add CI job to initialize the DB automatically after the addon is created, or wire up a GitHub Action to run `python -m backend.init_db` once the `DATABASE_URL` is present.

Triggering deploy from the repository (merge PR)
------------------------------------------------
When the project is connected to Railway with automatic deploys enabled, merging a PR into `main` will trigger a build and deploy. If you prefer to merge from the command line with the GitHub CLI, run:

```bash
# ensure you are authenticated with `gh`
gh pr view <PR_NUMBER> --repo <OWNER/REPO> --web
# Or merge directly from the CLI (this will delete the branch if merged):
gh pr merge <PR_NUMBER> --repo <OWNER/REPO> --merge --delete-branch
```

If the PR is reported as conflicting, fetch the latest `main`, merge it into your branch, resolve conflicts, push the branch, then merge the PR. Example sequence (run from your feature branch):

```bash
git fetch origin
git merge origin/main
# Resolve any conflicts, then:
git add <resolved-files>
git commit
git push
# Then merge the PR via web UI or `gh pr merge` as shown above.
```

Running the DB initialization remotely
-------------------------------------
After provisioning the Postgres add-on in Railway (or setting `DATABASE_URL` to a Supabase connection string), you must initialize the schema and seed demo data once. You can do this in three ways:

- Railway UI "Run" command: open the project, choose "Run a command" and execute:

```bash
python -m backend.init_db
```

- Railway CLI (if you're logged in and the project is linked):

```bash
railway run python -m backend.init_db
```

- GitHub Actions (recommended for repeatable CI): store `DATABASE_URL` as a repository secret and use the workflow below.

Sample GitHub Action (initialize DB on push to `main` or manual dispatch)
----------------------------------------------------------------------
Create `.github/workflows/init-db.yml` with the following content and protect the `DATABASE_URL` as a repository secret (or use organization secrets):

```yaml
name: Initialize Database

on:
	workflow_dispatch:
	push:
		branches:
			- main

jobs:
	init-db:
		runs-on: ubuntu-latest
		steps:
			- uses: actions/checkout@v4
			- uses: actions/setup-python@v4
				with:
					python-version: '3.11'
			- name: Install backend deps
				run: |
					python -m pip install --upgrade pip
					pip install -r backend/requirements.txt
			- name: Ensure DATABASE_URL is present
				run: |
					if [ -z "${{ secrets.DATABASE_URL }}" ]; then
						echo "DATABASE_URL secret not set in repository. Aborting." >&2
						exit 1
					fi
			- name: Initialize DB
				env:
					DATABASE_URL: ${{ secrets.DATABASE_URL }}
					AURAGATE_REQUIRE_DB_ON_STARTUP: 'false'
				run: |
					python -m backend.init_db
```

Verifying deployment and health
-------------------------------
Once Railway finishes the build/deploy (check your Railway project UI or Deployment logs), verify the API is healthy. Replace `<project-domain>` with the Railway-assigned host for your service (e.g., `auragate-core.up.railway.app`):

```bash
curl -fsS https://<project-domain>/api/health | jq
# Expected JSON contains "status": "ok" and "database": "connected"
```

If you do not know the project domain, use the Railway UI or the CLI (`railway status` / `railway open`) to locate the public URL.

Supabase-specific notes
-----------------------
- When using Supabase, prefer the `postgresql://` form of the connection string when possible; our code will rewrite `postgres://` → `postgresql://` automatically but using the canonical scheme avoids ambiguity.
- Supabase connection pooling: if you expect many concurrent connections, enable Supabase's connection pooling or configure PgBouncer to avoid connection saturation.

Security and post-deploy checklist
---------------------------------
- After successful DB init and smoke checks, set `AURAGATE_REQUIRE_DB_ON_STARTUP=true` in Railway to enforce DB availability on restarts.
- Replace `IVR_ADAPTER=noop` with your production IVR adapter configuration and ensure Twilio credentials (or other provider secrets) are stored securely in Railway variables.
- Rotate any demo secrets used during seeding.

Repository helpers
------------------
This repository includes a couple of convenience files to help with Railway deployments:

- `railway.json.sample` — an example Railway config-as-code file. It demonstrates a recommended `startCommand` for the backend service and minimal env defaults for first deploy. Copy and adapt it if you use Railway config-as-code.
- `scripts/init_db_remote.sh` — a small executable helper to run the DB initialization (`python -m backend.init_db`) inside the Railway container or via `railway run`.

Examples:

```bash
# Run the init script via the Railway CLI (project must be linked):
railway run ./scripts/init_db_remote.sh

# Or run the script directly inside the container (ensuring DATABASE_URL is present):
AURAGATE_REQUIRE_DB_ON_STARTUP=false ./scripts/init_db_remote.sh
```

If you'd like, I can add the `.github/workflows/init-db.yml` workflow to this repository and push it for you, and/or attempt the Railway CLI `railway run` command here if you want me to try running it from this environment.
