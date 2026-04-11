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
	"flat_number": "T4-402",
	"phone_number": "+919999000000",
	"image_payload": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
}
```

`image_payload` is optional and is expected as a camera snapshot data URL from the guard kiosk flows.

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
		"phone_number": "+919999000000",
		"image_payload": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
		"group_id": null,
		"status": "pending",
		"timestamp": "2026-04-04T10:31:28.123456+00:00"
	}
}
```

### Error Behavior
- Status `404` when resident flat is not registered.

## Endpoint: Visitor History
- Method: `GET`
- Path: `/api/visitors/history`
- Purpose: return recent visitor records used by guard/admin dashboard history views.

### Query Parameters
- `limit` (optional, default `30`, min `1`, max `200`)

### Success Response
- Status: `200 OK`
```json
{
	"visitors": [
		{
			"id": "11111111-1111-1111-1111-111111111111",
			"visitor_name": "Ramesh Kumar",
			"visitor_type": "Delivery",
			"flat_number": "T4-402",
			"phone_number": "+919999000000",
			"image_payload": null,
			"ocr_text": null,
			"group_id": null,
			"status": "pending",
			"timestamp": "2026-04-11T10:31:28.123456+00:00"
		}
	]
}
```

### Notes
- Backend first uses ORM query path, then falls back to a raw SQL compatibility query for legacy DB schemas.
- If both primary and fallback query paths fail, endpoint returns an empty visitor list (`{"visitors": []}`) to keep guard/admin UI operational.

## Endpoint: Multi-Flat Visitor Check-In
- Method: `POST`
- Path: `/api/visitors/multi-flat`
- Purpose: create one pending visitor record per flat and fan out notifications to all listed residents.

### Request Body
```json
{
	"visitor_name": "Blinkit Agent",
	"visitor_type": "Delivery",
	"flat_numbers": ["T4-401", "T4-402", "T4-503"],
	"phone_number": "+919999000000",
	"image_payload": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
}
```

### Success Response
- Status: `201 Created`
```json
{
	"message": "Multi-flat visitor check-in recorded.",
	"group_id": "11111111-1111-1111-1111-111111111111",
	"visitors": [
		{
			"id": "22222222-2222-2222-2222-222222222222",
			"visitor_name": "Blinkit Agent",
			"visitor_type": "Delivery",
			"flat_number": "T4-401",
			"phone_number": "+919999000000",
			"image_payload": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
			"group_id": "11111111-1111-1111-1111-111111111111",
			"status": "pending",
			"timestamp": "2026-04-10T10:31:28.123456+00:00"
		}
	]
}
```

### Error Behavior
- Status `404` when any flat in `flat_numbers` is not registered.
- Status `422` when `flat_numbers` resolves to an empty set.

## Endpoint: Unplanned Visitor Quick Action
- Method: `POST`
- Path: `/api/visitors/unplanned`
- Purpose: quick guard action for unknown/staff/unplanned entries while preserving escalation flow.

### Request Body
```json
{
	"category": "Unknown",
	"flat_number": "T4-402",
	"visitor_name": "Unknown",
	"phone_number": "+919999000000",
	"image_payload": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
}
```

### Success Response
- Status: `201 Created`
```json
{
	"message": "Unplanned Unknown entry recorded.",
	"visitor": {
		"id": "33333333-3333-3333-3333-333333333333",
		"visitor_name": "Unknown",
		"visitor_type": "Unknown",
		"flat_number": "T4-402",
		"phone_number": "+919999000000",
		"image_payload": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
		"group_id": null,
		"status": "pending",
		"timestamp": "2026-04-10T10:31:28.123456+00:00"
	}
}
```

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

## Endpoint: Invite TOTP Seed (Create)
- Method: `GET`
- Path: `/api/totp/generate`
- Purpose: create a persisted expected-guest visitor row and return the seed metadata used to render rotating QR/TOTP on the invite page.

### Query Parameters
- `guest_name` (required)
- `flat_number` (required)

### Success Response
```json
{
	"visitor_id": "11111111-1111-1111-1111-111111111111",
	"visitor_name": "Ramesh Kumar",
	"flat_number": "T4-401",
	"secret_seed": "BASE32SECRET",
	"provisioned_uri": "otpauth://totp/AuraGate%20Invite:...",
	"secret": "BASE32SECRET",
	"current_otp": "123456",
	"valid_for_seconds": 41,
	"interval_seconds": 60
}
```

### Error Behavior
- `404` when `flat_number` is not a registered resident.
- `503` when TOTP service is unavailable.

## Endpoint: Invite TOTP Seed (Fetch Existing)
- Method: `GET`
- Path: `/api/totp/invite/{visitor_id}`
- Purpose: fetch the persisted invite seed metadata for an existing visitor row, used by invite links keyed by DB `visitor_id`.

### Success Response
```json
{
	"visitor_id": "11111111-1111-1111-1111-111111111111",
	"visitor_name": "Ramesh Kumar",
	"flat_number": "T4-401",
	"secret_seed": "BASE32SECRET",
	"provisioned_uri": "otpauth://totp/AuraGate%20Invite:...",
	"secret": "BASE32SECRET",
	"current_otp": "123456",
	"valid_for_seconds": 41,
	"interval_seconds": 60
}
```

### Error Behavior
- `404` when `visitor_id` is unknown.
- `400` when the visitor has no `secret_seed`.
- `503` when TOTP service is unavailable.

## Endpoint: Verify Visitor TOTP (Guard)
- Method: `POST`
- Path: `/api/visitors/verify-totp`
- Purpose: verify guard-scanned 6-digit code against persisted `visitor_logs.secret_seed` and directly approve known expected guests.

### Request Body
```json
{
	"visitor_id": "11111111-1111-1111-1111-111111111111",
	"scanned_code": "123456"
}
```

### Success Response
```json
{
	"success": true,
	"status": "APPROVED"
}
```

### Error Behavior
- `400` for malformed input, missing visitor seed, or non-expected-guest visitor types.
- `401` when code is invalid or expired.
- `404` when visitor is not found.

### Notes
- Verification uses DB-persisted `secret_seed` and 60-second interval.
- If visitor is already approved, endpoint is idempotent and still returns success.
- On success, backend emits `visitor_approved` on resident and guard channels.

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

## Endpoint: Escalate
- Method: POST
- Path: /api/escalate
- Purpose: Trigger an IVR escalation for a specific flat when a timer or external monitor decides to escalate.

### Request Body
```json
{
  "flat_number": "T4-401",
  "visitor_type": "Delivery",
  "status": "timeout"
}
```

### Success Response
- Status: 200 OK
```json
{
  "success": true,
  "message": "IVR Call Triggered to Resident"
}
```

### Adapter Failure Response
- Status: 200 OK (request accepted but IVR provider call failed)
```json
{
	"success": false,
	"message": "Failed to trigger IVR Call"
}
```

### Failure Response
- Status: 400 Bad Request (e.g., no phone configured)
```json
{
  "detail": "No phone number configured for resident or fallback"
}
```

### Curl Example (smoke test)
```bash
curl -sS -X POST -H "Content-Type: application/json" \
	-d '{"flat_number":"T4-401","visitor_type":"Delivery"}' \
	http://localhost:8000/api/escalate
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

