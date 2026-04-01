#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: not inside a git repository."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Error: remote 'origin' not found. Please add a remote named 'origin' and re-run."
  exit 1
fi

current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD)
echo "Current branch: $current_branch"

# 1) Create and switch to 'dev' branch from current branch
if git show-ref --verify --quiet refs/heads/dev; then
  echo "Switching to existing branch 'dev'"
  git checkout dev
else
  echo "Creating branch 'dev' from $current_branch"
  git checkout -b dev
fi

# 2) Scaffold folder structure
mkdir -p backend/api backend/core backend/services \
         frontend/src/components frontend/src/pages frontend/src/utils \
         docs

# Create minimal files if they don't already exist
if [ ! -f backend/main.py ]; then
cat > backend/main.py <<'PY'
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello from AuraGate backend"}
PY
else
  echo "backend/main.py exists; skipping"
fi

if [ ! -f backend/requirements.txt ]; then
cat > backend/requirements.txt <<'REQ'
fastapi
uvicorn
REQ
else
  echo "backend/requirements.txt exists; skipping"
fi

if [ ! -f frontend/package.json ]; then
cat > frontend/package.json <<'JSON'
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true
}
JSON
else
  echo "frontend/package.json exists; skipping"
fi

if [ ! -f docs/API_CONTRACT.md ]; then
cat > docs/API_CONTRACT.md <<'MD'
# API Contract

Describe API endpoints, request/response schemas, authentication, and examples here.
MD
else
  echo "docs/API_CONTRACT.md exists; skipping"
fi

# 3) Add root .gitignore entries
if [ ! -f .gitignore ]; then
cat > .gitignore <<'GIT'
node_modules/
__pycache__/
venv/
.env
GIT
else
  echo ".gitignore exists; ensuring required entries are present"
  grep -qxF "node_modules/" .gitignore || echo "node_modules/" >> .gitignore
  grep -qxF "__pycache__/" .gitignore || echo "__pycache__/" >> .gitignore
  grep -qxF "venv/" .gitignore || echo "venv/" >> .gitignore
  grep -qxF ".env" .gitignore || echo ".env" >> .gitignore
fi

# 4) Stage and commit the new files (only the scaffold files)
created_files=( \
  "backend/main.py" \
  "backend/requirements.txt" \
  "frontend/package.json" \
  "docs/API_CONTRACT.md" \
  ".gitignore" \
)

to_add=()
for f in "${created_files[@]}"; do
  if [ -e "$f" ]; then
    to_add+=("$f")
  fi
done

if [ "${#to_add[@]}" -gt 0 ]; then
  git add "${to_add[@]}"
  if git diff --cached --quiet; then
    echo "No changes to commit for scaffold files."
  else
    git commit -m "chore: initial project scaffolding"
    git push --set-upstream origin dev
  fi
else
  echo "No scaffold files found to add/commit."
fi

# 5) From dev create and push feat/twilio-engine
if git show-ref --verify --quiet refs/heads/feat/twilio-engine; then
  echo "Local branch 'feat/twilio-engine' exists; checking it out"
  git checkout feat/twilio-engine
else
  git checkout -b feat/twilio-engine
fi
git push --set-upstream origin feat/twilio-engine

# 6) Switch back to dev
git checkout dev

# 7) Create and push feat/ui-dashboard
if git show-ref --verify --quiet refs/heads/feat/ui-dashboard; then
  echo "Local branch 'feat/ui-dashboard' exists; checking it out"
  git checkout feat/ui-dashboard
else
  git checkout -b feat/ui-dashboard
fi
git push --set-upstream origin feat/ui-dashboard

# 8) Switch back to dev (ready for PRs)
git checkout dev

echo "Scaffolding complete. Current branch: $(git symbolic-ref --short HEAD)"
