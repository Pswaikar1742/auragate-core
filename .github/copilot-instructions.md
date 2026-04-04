# Copilot Instructions for AuraGate

Always use the repository docs as the source of operational context.

## Required Read Order (Every Prompt)
1. `docs/SYSTEM_INSTRUCTIONS.md`
2. `docs/README.md`
3. `plan.md`
4. `docs/phases/README.md`
5. Active phase file
6. `docs/STATE_LOG.md`
7. `docs/API_CONTRACT.md` and `docs/AURAGATE_CONTEXT.md` as needed

## Execution Protocol
- Work phase by phase.
- Scope each prompt to one small increment.
- Run recursive testing loops:
  - narrow checks first
  - fix and rerun until green
  - broad suite next
  - fix and rerun until green
- Do not finish a cycle without documentation updates.

## End-of-Cycle Documentation Updates
Update all applicable files:
- `docs/STATE_LOG.md`
- active `docs/phases/*.md`
- changed technical contract docs

## Restart and Resume
- For fresh starts, follow Cold Start Protocol in `docs/PROMPT_PROTOCOL.md`.
- For continuation, follow Resume Protocol in `docs/PROMPT_PROTOCOL.md`.
