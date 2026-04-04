# Phase 04: Integration and Recursive Testing

## Objective
Converge frontend and backend into a repeatedly verified end-to-end Golden Thread.

## In Scope
- frontend/backend runtime integration
- timeout to escalation flow validation
- structured recursive test loops and evidence capture

## Tasks
- [ ] Execute full Golden Thread scenario repeatedly.
- [ ] Confirm payload and response schema stability.
- [ ] Document all failing cases and fixes in state log.
- [ ] Add/refresh run commands in docs if changed.

## Recursive Test Gates
- run narrow checks on changed area
- if fail: fix -> rerun narrow checks
- run broad suite (lint/build/integration)
- if fail: fix -> rerun narrow + broad

## Exit Criteria
- at least one clean full-cycle run documented
- no unresolved integration defects for MVP path
- all test evidence recorded

## Progress Notes
- Awaiting dedicated integration execution loops.
