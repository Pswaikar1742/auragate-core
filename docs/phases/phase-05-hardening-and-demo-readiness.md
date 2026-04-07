# Phase 05: Hardening and Demo Readiness

## Objective
Prepare a stable and presentation-ready MVP with operational confidence.

## In Scope
- graceful error messaging
- startup runbook for local demo
- secret handling verification
- fallback strategy for external dependency issues

## Tasks
- [ ] Validate `.env` handling and secret hygiene.
- [ ] Create/verify a quick demo startup checklist.
- [ ] Validate behavior when Twilio/env config is missing.
- [ ] Final UI and messaging polish for live demo clarity.

## Recursive Test Gates
- simulate partial failures (missing env, backend unavailable)
- verify clear user feedback and safe behavior
- rerun full happy-path after each fix

## Exit Criteria
- demo can be run from clean machine using docs
- error cases are controlled and documented
- final runbook is complete

## Progress Notes
- Kickoff started with a requirements-vs-code gap assessment using the provided PDF blueprints.
- Current MVP is working for the Golden Thread (guard check-in -> resident WebSocket -> escalation API -> IVR adapter trigger) with local integration evidence.
- Major hardening/demo items still pending:
	- clean demo runbook for a fresh machine
	- explicit fallback/error UX for backend-unavailable and env-missing scenarios
	- feature-gap documentation for non-MVP blueprint workflows (multi-flat delivery, scout detection, voice-first capture, SOS override, etc.)

Immediate next increment in this phase:
- Produce an implementation status matrix and prioritize Phase-05 tasks by demo impact.
