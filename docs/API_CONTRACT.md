# API Contract

This file defines the current stateful prototype API behavior.

## Base URL (Local)
- Backend HTTP: `http://localhost:8000`
- Backend WS: `ws://localhost:8000`

## Data States
`VisitorLog.status` values used by backend and frontend:
- `pending`
- `approved`
- `denied`
- `escalated_ivr`

## Endpoint: Health Check
- Method: `GET`
- Path: `/health`

### Success Response
```json
{
	"status": "ok"
}
```

## Endpoint: Visitor Check-In
- Method: `POST`
- Path: `/api/visitors/check-in`
- Purpose: register visitor, persist row, notify resident socket, schedule escalation timer

### Request Body
```json
{
	"visitor_name": "Ramesh Kumar",
	"visitor_type": "Delivery",
	"flat_number": "T4-402"
}
```

### Success Response
- Status: `201 Created`
```json
{
	"message": "Visitor check-in recorded.",
	"visitor": {
		"id": "11111111-1111-1111-1111-111111111111",
		"visitor_name": "Ramesh Kumar",
		"visitor_type": "Delivery",
		"flat_number": "T4-402",
		"status": "pending",
		"timestamp": "2026-04-04T10:31:28.123456+00:00"
	}
}
```

### Error Behavior
- Status `404` when resident flat is not registered.

## Endpoint: Approve Visitor
- Method: `PUT`
- Path: `/api/visitors/{visitor_id}/approve`
- Purpose: mark visitor as approved before escalation timeout

### Success Response
- Status: `200 OK`
```json
{
	"message": "Visitor approved successfully.",
	"visitor": {
		"id": "11111111-1111-1111-1111-111111111111",
		"visitor_name": "Ramesh Kumar",
		"visitor_type": "Delivery",
		"flat_number": "T4-402",
		"status": "approved",
		"timestamp": "2026-04-04T10:31:28.123456+00:00"
	}
}
```

### Error Behavior
- Status `404` when `visitor_id` is not found.

## Endpoint: Guard TOTP Payload
- Method: `GET`
- Path: `/api/guard/totp`
- Purpose: provide TOTP data for guard QR rendering

### Success Response
```json
{
	"secret": "BASE32SECRET",
	"otp_auth_uri": "otpauth://totp/AuraGate:...",
	"current_otp": "123456",
	"valid_for_seconds": 18,
	"interval_seconds": 30
}
```

## WebSocket: Resident Channel
- Path: `/ws/resident/{flat_number}`

### Events Emitted by Backend
- `connected`
- `visitor_checked_in`
- `visitor_approved`
- `visitor_escalated`
- `pong` (reply to client ping)

### Event Envelope
```json
{
	"event": "visitor_checked_in",
	"visitor": {
		"id": "11111111-1111-1111-1111-111111111111",
		"visitor_name": "Ramesh Kumar",
		"visitor_type": "Delivery",
		"flat_number": "T4-402",
		"status": "pending",
		"timestamp": "2026-04-04T10:31:28.123456+00:00"
	}
}
```

## Escalation Timer Contract
- On every check-in, backend starts `asyncio.create_task(escalation_timer(...))`.
- Timer sleeps for 30 seconds.
- If visitor is still `pending`, backend:
	1. updates status to `escalated_ivr`
	2. finds resident phone number
	3. calls Twilio Voice API
	4. emits `visitor_escalated` on resident socket

## Required Environment Variables
- `DATABASE_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TO_PHONE_NUMBER`
- `GUARD_TOTP_SECRET` (optional)
- `AURAGATE_SOCIETY_NAME` (optional)

