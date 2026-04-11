"""AuraGate stateful backend with DB persistence, WebSockets, and async escalation tasks."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import hmac
import io
import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

try:
    import pyotp
except Exception:
    pyotp = None
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, WebSocket, WebSocketDisconnect, status, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
try:
    # Prefer an absolute package import (works when the project root is
    # on PYTHONPATH / when running from repository root).
    from backend.ivr_adapter import get_adapter, IVRAdapter
except ImportError:
    try:
        # Support running from the `backend/` working directory during
        # local development (e.g. `uvicorn main:app` inside backend/).
        from ivr_adapter import get_adapter, IVRAdapter
    except ImportError:
        # As a last resort, attempt a relative import (when executed as a
        # package, e.g. `python -m backend.main`).
        from .ivr_adapter import get_adapter, IVRAdapter

# Module-level override to allow tests to inject a test adapter instance.
_ivr_adapter_override: Optional[IVRAdapter] = None


def set_ivr_adapter(adapter: Optional[IVRAdapter]) -> None:
    """Inject an IVR adapter instance for runtime or tests.

    Pass `None` to clear the override and fall back to `get_adapter()`.
    """
    global _ivr_adapter_override
    _ivr_adapter_override = adapter


def clear_ivr_adapter() -> None:
    """Clear any previously injected IVR adapter."""
    set_ivr_adapter(None)


def _get_effective_ivr_adapter() -> IVRAdapter:
    """Return the injected adapter if present, otherwise resolve via `get_adapter()`."""
    if _ivr_adapter_override is not None:
        return _ivr_adapter_override
    return get_adapter()

try:
    from . import models
    from .database import (
        SessionLocal,
        check_database_connection,
        create_db_and_tables,
        database_driver_name,
        database_target_name,
        get_db,
    )
except ImportError:
    import models
    from database import (
        SessionLocal,
        check_database_connection,
        create_db_and_tables,
        database_driver_name,
        database_target_name,
        get_db,
    )

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("auragate")

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_ESCALATED_IVR = "escalated_ivr"
STATUS_HIGH_RISK_IDENTITY = "high_risk_identity"
STATUS_HIGH_RISK_SCOUT = "high_risk_scout"

DEMO_SOCIETY_NAME = os.getenv("AURAGATE_SOCIETY_NAME", "Prestige Falcon City, Tower 4")
RESIDENT_SESSION_TTL_HOURS = int(os.getenv("AURAGATE_RESIDENT_SESSION_HOURS", "12"))
PIN_HASH_ITERATIONS = int(os.getenv("AURAGATE_PIN_HASH_ITERATIONS", "120000"))
REQUIRE_DB_ON_STARTUP = os.getenv("AURAGATE_REQUIRE_DB_ON_STARTUP", "true").strip().lower() not in {
    "0",
    "false",
    "no",
}

DEMO_RESIDENTS: dict[str, dict[str, str]] = {
    "T4-401": {"resident_name": "Neha Rao", "pin": "1111"},
    "T4-402": {"resident_name": "Aarav Mehta", "pin": "1234"},
    "T4-503": {"resident_name": "Ishita Kulkarni", "pin": "4321"},
}

if pyotp is not None:
    GUARD_TOTP_SECRET = os.getenv("GUARD_TOTP_SECRET", pyotp.random_base32())
else:
    # Fallback secret for test/CI environments where pyotp is not installed
    GUARD_TOTP_SECRET = os.getenv("GUARD_TOTP_SECRET", secrets.token_hex(16))
TOTP_INTERVAL_SECONDS = 30


class VisitorCheckInRequest(BaseModel):
    """Guard tablet payload for registering a new visitor."""

    visitor_name: str = Field(..., min_length=1, max_length=120)
    visitor_type: str = Field(..., min_length=1, max_length=32)
    flat_number: str = Field(..., min_length=1, max_length=32)
    phone_number: str | None = Field(default=None, min_length=7, max_length=24)
    image_payload: str | None = None
    image_ocr_text: str | None = None


class VisitorPayload(BaseModel):
    """Public visitor representation shared over API and WebSocket."""

    id: uuid.UUID
    visitor_name: str
    visitor_type: str
    flat_number: str
    phone_number: str | None = None
    image_payload: str | None = None
    ocr_text: str | None = None
    group_id: str | None = None
    status: str
    timestamp: datetime


class VisitorMutationResponse(BaseModel):
    """Response returned after check-in and approve actions."""

    message: str
    visitor: VisitorPayload
    guest_qr_payload: dict[str, str] | None = None
    qr_valid_for_seconds: int | None = None
    qr_interval_seconds: int | None = None


class MultiFlatVisitorMutationResponse(BaseModel):
    """Response returned after multi-flat check-in action."""

    message: str
    group_id: str
    visitors: list[VisitorPayload]


class VisitorHistoryResponse(BaseModel):
    """Paginated-style visitor history payload for analytics/admin views."""

    visitors: list[VisitorPayload]


class GuardTotpResponse(BaseModel):
    """TOTP payload consumed by guard UI for QR rendering."""

    secret: str
    otp_auth_uri: str
    current_otp: str
    valid_for_seconds: int
    interval_seconds: int


class InviteTotpResponse(BaseModel):
    """TOTP payload for visitor invite pass generation."""

    visitor_id: str
    secret_seed: str
    provisioned_uri: str
    # Keep `secret` for backwards compatibility with existing invite UI payload parsing.
    secret: str
    current_otp: str
    valid_for_seconds: int
    interval_seconds: int


class UnplannedVisitorRequest(BaseModel):
    """Payload for guard kiosk unplanned-visitor quick actions."""

    category: Literal["Delivery", "Maid", "Staff", "Unknown"]
    flat_number: str = Field(default="T4-402", min_length=1, max_length=32)
    visitor_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone_number: str | None = Field(default=None, min_length=7, max_length=24)
    image_payload: str | None = None
    image_ocr_text: str | None = None


class MultiFlatVisitorRequest(BaseModel):
    """Payload for one visitor targeting multiple flats."""

    visitor_name: str = Field(..., min_length=1, max_length=120)
    visitor_type: str = Field(..., min_length=1, max_length=32)
    flat_numbers: list[str] = Field(..., min_length=1, max_length=25)
    phone_number: str | None = Field(default=None, min_length=7, max_length=24)
    image_payload: str | None = None
    image_ocr_text: str | None = None


class VerifyVisitorTotpRequest(BaseModel):
    """Payload for validating visitor TOTP at gate."""

    visitor_id: str = Field(..., min_length=1, max_length=64)
    scanned_code: str = Field(..., min_length=4, max_length=12)


class VerifyVisitorTotpResponse(BaseModel):
    """Response for server-side expected guest TOTP verification."""

    success: bool
    status: Literal["APPROVED"]


class EmergencySOSRequest(BaseModel):
    """Payload to trigger emergency alert fan-out for guard/admin channels."""

    flat_number: str = Field(..., min_length=1, max_length=32)
    source: Literal["guard_kiosk", "resident_duress"]


class EscalateRequest(BaseModel):
    """Request model for explicit escalation trigger."""

    flat_number: str = Field(..., min_length=1, max_length=32)
    visitor_type: str = Field(..., min_length=1, max_length=32)
    status: str = Field(default="timeout")


class MessageResponse(BaseModel):
    """Simple API response envelope with message text."""

    message: str


class ResidentProfilePayload(BaseModel):
    """Resident profile payload exposed to frontend clients."""

    flat_number: str
    resident_name: str
    phone_number: str | None


class ResidentAuthLoginRequest(BaseModel):
    """Resident login payload using flat number and PIN."""

    flat_number: str = Field(..., min_length=1, max_length=32)
    pin: str = Field(..., min_length=4, max_length=12)


class ResidentAuthResponse(BaseModel):
    """Resident login/session response with bearer token."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    resident: ResidentProfilePayload


class ResidentSessionResponse(BaseModel):
    """Active resident session response."""

    authenticated: bool
    expires_at: datetime
    resident: ResidentProfilePayload


class ResidentNotificationPayload(BaseModel):
    """Resident notification row returned over API."""

    id: uuid.UUID
    visitor_id: uuid.UUID | None
    event_type: str
    title: str
    detail: str
    is_read: bool
    created_at: datetime
    read_at: datetime | None


class ResidentNotificationsResponse(BaseModel):
    """Resident notification listing with unread counters."""

    unread_count: int
    notifications: list[ResidentNotificationPayload]


class ResidentSettingsPayload(BaseModel):
    """Resident notification and statement settings."""

    notify_push: bool
    notify_whatsapp: bool
    statement_preference: Literal["csv", "json"]
    quiet_hours_start: str | None
    quiet_hours_end: str | None
    timezone_name: str


class ResidentSettingsUpdateRequest(BaseModel):
    """Partial update request for resident settings."""

    notify_push: bool | None = None
    notify_whatsapp: bool | None = None
    statement_preference: Literal["csv", "json"] | None = None
    quiet_hours_start: str | None = Field(default=None, max_length=8)
    quiet_hours_end: str | None = Field(default=None, max_length=8)
    timezone_name: str | None = Field(default=None, min_length=3, max_length=64)


class ResidentDashboardResponse(BaseModel):
    """Resident dashboard data payload."""

    resident: ResidentProfilePayload
    pending_approvals: list[VisitorPayload]
    unread_notifications: int
    notifications: list[ResidentNotificationPayload]
    recent_visitors: list[VisitorPayload]
    settings: ResidentSettingsPayload


class ResidentVisitStatementResponse(BaseModel):
    """JSON variant of resident visit-statement export payload."""

    generated_at: datetime
    flat_number: str
    visits: list[VisitorPayload]


class ConnectionManager:
    """Tracks active resident WebSocket connections by flat number."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, flat_number: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(flat_number, set()).add(websocket)
        logger.info("WebSocket connected for flat=%s", flat_number)

    async def disconnect(self, flat_number: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(flat_number)
            if sockets and websocket in sockets:
                sockets.remove(websocket)
            if sockets and len(sockets) == 0:
                self._connections.pop(flat_number, None)
        logger.info("WebSocket disconnected for flat=%s", flat_number)

    async def broadcast(self, flat_number: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections.get(flat_number, set()))

        if not sockets:
            return

        stale_sockets: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale_sockets.append(websocket)

        for websocket in stale_sockets:
            await self.disconnect(flat_number, websocket)


ws_manager = ConnectionManager()
admin_ws_manager = ConnectionManager()
guard_ws_manager = ConnectionManager()
running_tasks: set[asyncio.Task[None]] = set()


async def _broadcast_guard_event(
    event: str,
    visitor_payload: VisitorPayload,
    *,
    source: str,
    priority: str = "normal",
    extra: dict[str, Any] | None = None,
) -> None:
    """Broadcast visitor lifecycle updates to guard notification channel."""

    payload: dict[str, Any] = {
        "event": event,
        "priority": priority,
        "source": source,
        "flat_number": visitor_payload.flat_number,
        "visitor": visitor_payload.model_dump(mode="json"),
    }
    if extra:
        payload.update(extra)

    await guard_ws_manager.broadcast("guard", payload)


def _serialize_visitor(visitor: models.VisitorLog) -> VisitorPayload:
    """Convert ORM model into typed response payload."""

    return VisitorPayload(
        id=visitor.id,
        visitor_name=visitor.visitor_name,
        visitor_type=visitor.visitor_type,
        flat_number=visitor.flat_number,
        phone_number=visitor.phone_number,
        image_payload=visitor.image_payload,
        ocr_text=visitor.ocr_text if hasattr(visitor, 'ocr_text') else None,
        group_id=visitor.group_id,
        status=visitor.status,
        timestamp=visitor.timestamp,
    )


def _serialize_resident(resident: models.Resident) -> ResidentProfilePayload:
    """Convert resident ORM row into API-safe payload."""

    return ResidentProfilePayload(
        flat_number=resident.flat_number,
        resident_name=resident.resident_name,
        phone_number=resident.phone_number or None,
    )


def _serialize_resident_settings(resident: models.Resident) -> ResidentSettingsPayload:
    """Convert resident settings from DB row to response model."""

    preference = resident.statement_preference if resident.statement_preference in ("csv", "json") else "csv"
    return ResidentSettingsPayload(
        notify_push=resident.notify_push,
        notify_whatsapp=resident.notify_whatsapp,
        statement_preference=preference,
        quiet_hours_start=resident.quiet_hours_start,
        quiet_hours_end=resident.quiet_hours_end,
        timezone_name=resident.timezone_name or "Asia/Kolkata",
    )


def _serialize_notification(row: models.ResidentNotification) -> ResidentNotificationPayload:
    """Convert resident notification ORM row into response payload."""

    return ResidentNotificationPayload(
        id=row.id,
        visitor_id=row.visitor_id,
        event_type=row.event_type,
        title=row.title,
        detail=row.detail,
        is_read=row.is_read,
        created_at=row.created_at,
        read_at=row.read_at,
    )


def _normalize_flat_number(flat_number: str) -> str:
    """Normalize flat number input for stable lookups and auth."""

    return flat_number.strip().upper()


def _normalize_phone_number(phone_number: str | None) -> str | None:
    """Normalize phone number input for visitor anomaly checks."""

    if phone_number is None:
        return None
    normalized = phone_number.strip()
    return normalized or None


def _detect_anomaly_status(
    db: Session,
    phone_number: str | None,
    visitor_name: str,
    current_flat_number: str | None = None,
) -> str | None:
    """Detect lightweight anomaly flags from visitor history for demo-time risk scoring."""

    normalized_phone = _normalize_phone_number(phone_number)
    if not normalized_phone:
        return None

    normalized_name = visitor_name.strip().lower()

    identity_collision = (
        db.query(models.VisitorLog.id)
        .filter(
            models.VisitorLog.phone_number == normalized_phone,
            func.lower(models.VisitorLog.visitor_name) != normalized_name,
        )
        .first()
        is not None
    )

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    distinct_flat_rows = (
        db.query(models.VisitorLog.flat_number)
        .filter(
            models.VisitorLog.phone_number == normalized_phone,
            models.VisitorLog.timestamp >= seven_days_ago,
        )
        .distinct()
        .all()
    )
    distinct_flats = {row[0] for row in distinct_flat_rows}
    if current_flat_number:
        distinct_flats.add(_normalize_flat_number(current_flat_number))

    if len(distinct_flats) >= 3:
        return STATUS_HIGH_RISK_SCOUT
    if identity_collision:
        return STATUS_HIGH_RISK_IDENTITY
    return None


def _hash_pin(pin: str, salt: str) -> str:
    """PBKDF2 hash used for resident PIN verification."""

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        pin.encode("utf-8"),
        salt.encode("utf-8"),
        PIN_HASH_ITERATIONS,
    )
    return digest.hex()


def _create_pin_credentials(pin: str) -> tuple[str, str]:
    """Create salt/hash tuple for a resident PIN."""

    salt = secrets.token_hex(16)
    pin_hash = _hash_pin(pin, salt)
    return salt, pin_hash


def _verify_pin(pin: str, salt: str, expected_hash: str) -> bool:
    """Constant-time resident PIN verification."""

    if not pin or not salt or not expected_hash:
        return False
    return hmac.compare_digest(_hash_pin(pin, salt), expected_hash)


def _hash_session_token(token: str) -> str:
    """Hash session tokens before persisting to DB."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _extract_bearer_token(authorization: str | None) -> str:
    """Extract bearer token from Authorization header value."""

    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing resident session token")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Authorization header")
    return token.strip()


def _create_resident_notification(
    db: Session,
    *,
    resident: models.Resident | None,
    flat_number: str,
    event_type: str,
    title: str,
    detail: str,
    visitor_id: uuid.UUID | None = None,
) -> models.ResidentNotification | None:
    """Create resident notification row for dashboard and missed-alert tracking."""

    resolved_resident = resident
    if resolved_resident is None:
        resolved_resident = (
            db.query(models.Resident)
            .filter(models.Resident.flat_number == _normalize_flat_number(flat_number))
            .first()
        )

    if resolved_resident is None:
        return None

    notification = models.ResidentNotification(
        resident_id=resolved_resident.id,
        flat_number=resolved_resident.flat_number,
        visitor_id=visitor_id,
        event_type=event_type,
        title=title,
        detail=detail,
        is_read=False,
    )
    db.add(notification)
    return notification


def _require_resident_auth(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> tuple[uuid.UUID, uuid.UUID]:
    """Resolve and validate resident session from bearer token."""

    token = _extract_bearer_token(authorization)
    token_hash = _hash_session_token(token)

    session = (
        db.query(models.ResidentSession)
        .filter(models.ResidentSession.token_hash == token_hash)
        .first()
    )

    if session is None or session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalid. Please login again.")

    now = datetime.now(timezone.utc)
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at <= now:
        session.revoked_at = now
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please login again.")

    resident = db.get(models.Resident, session.resident_id)
    if resident is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Resident account not found")

    session.last_seen_at = now
    db.commit()
    db.refresh(session)
    return resident.id, session.id


def _schedule_task(coro: asyncio.Future[Any] | asyncio.Task[Any] | Any) -> None:
    """Track background task lifecycle to avoid orphaned tasks on shutdown."""

    task = asyncio.create_task(coro)
    running_tasks.add(task)
    task.add_done_callback(lambda finished: running_tasks.discard(finished))


def _twilio_message(visitor: models.VisitorLog) -> str:
    """Generate a TwiML IVR message that gathers digits and posts back to our callback.

    The generated `<Gather>` action includes the `visitor_id` so the callback can
    reliably map the response to the persisted visitor row.
    """

    visitor_id = str(visitor.id)

    # Prefer an explicit public base URL for Twilio callbacks so Twilio can
    # reach our `/api/ivr/callback` endpoint. This should be set to your
    # externally accessible URL (e.g. https://auragate-core.vercel.app or an
    # ngrok forwarding URL). Fall back to GOLDEN_THREAD_BASE for integration
    # script compatibility, otherwise use a relative path (may not work with
    # Twilio when running locally).
    public_base = os.getenv("AURAGATE_PUBLIC_URL") or os.getenv("GOLDEN_THREAD_BASE") or ""
    if public_base:
        public_base = public_base.rstrip("/")
        action_url = f"{public_base}/api/ivr/callback?visitor_id={visitor_id}"
    else:
        action_url = f"/api/ivr/callback?visitor_id={visitor_id}"

    # Use a Gather element to capture a single digit and POST to our callback.
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Response>"
        f"<Gather action=\"{action_url}\" method=\"POST\" numDigits=\"1\">"
        "<Say voice=\"alice\">"
        f"Alert from AuraGate at {DEMO_SOCIETY_NAME}. "
        f"{visitor.visitor_type} visitor {visitor.visitor_name} is waiting at the gate for flat {visitor.flat_number}. "
        "Press 1 to approve."
        "</Say>"
        "</Gather>"
        "<Say voice=\"alice\">No input received. Goodbye.</Say>"
        "</Response>"
    )


async def _trigger_ivr_call(phone_number: str, visitor: models.VisitorLog) -> str | None:
    """Trigger an IVR call via the configured IVR adapter. Returns SID-like token on success."""

    adapter = _get_effective_ivr_adapter()
    twiml = _twilio_message(visitor)

    try:
        result = await adapter.trigger_call(phone_number, twiml)
    except Exception as exc:
        logger.exception("IVR adapter failed for visitor_id=%s: %s", visitor.id, exc)
        return None

    sid = None
    if isinstance(result, dict):
        sid = result.get("sid")
    elif isinstance(result, str):
        sid = result

    if not sid:
        logger.error("IVR adapter returned no sid for visitor_id=%s result=%s", visitor.id, result)
        return None

    logger.info("IVR call triggered for visitor_id=%s, call_sid=%s", visitor.id, sid)
    return sid


def _seed_demo_residents() -> None:
    """Create demo resident rows if they do not exist."""

    demo_phone = os.getenv("TO_PHONE_NUMBER")
    if not demo_phone:
        logger.warning("TO_PHONE_NUMBER is not set. Demo residents will be seeded without phone fallback.")

    with SessionLocal() as db:
        for flat_number, profile in DEMO_RESIDENTS.items():
            normalized_flat = _normalize_flat_number(flat_number)
            existing = (
                db.query(models.Resident)
                .filter(models.Resident.flat_number == normalized_flat)
                .first()
            )
            if not existing:
                pin_salt, pin_hash = _create_pin_credentials(profile["pin"])
                db.add(
                    models.Resident(
                        flat_number=normalized_flat,
                        phone_number=demo_phone or "",
                        resident_name=profile["resident_name"],
                        pin_salt=pin_salt,
                        pin_hash=pin_hash,
                    )
                )
                continue

            if existing.resident_name.strip() == "":
                existing.resident_name = profile["resident_name"]

            if not existing.pin_salt or not existing.pin_hash:
                pin_salt, pin_hash = _create_pin_credentials(profile["pin"])
                existing.pin_salt = pin_salt
                existing.pin_hash = pin_hash

            if demo_phone and not existing.phone_number:
                existing.phone_number = demo_phone

            if not existing.timezone_name:
                existing.timezone_name = "Asia/Kolkata"

            if existing.statement_preference not in ("csv", "json"):
                existing.statement_preference = "csv"

        db.commit()


async def escalation_timer(visitor_id: uuid.UUID, flat_number: str) -> None:
    """Escalate unresolved visitor requests to IVR call after timeout."""

    await asyncio.sleep(30)
    normalized_flat = _normalize_flat_number(flat_number)

    with SessionLocal() as db:
        visitor = db.get(models.VisitorLog, visitor_id)
        if visitor is None:
            logger.warning("Escalation skipped: visitor_id=%s not found", visitor_id)
            return

        escalatable_statuses = {
            STATUS_PENDING,
            STATUS_HIGH_RISK_IDENTITY,
            STATUS_HIGH_RISK_SCOUT,
        }
        if visitor.status not in escalatable_statuses:
            logger.info("Escalation skipped: visitor_id=%s already resolved (%s)", visitor_id, visitor.status)
            return

        visitor.status = STATUS_ESCALATED_IVR

        resident = (
            db.query(models.Resident)
            .filter(models.Resident.flat_number == normalized_flat)
            .first()
        )
        phone_number = resident.phone_number if resident and resident.phone_number else os.getenv("TO_PHONE_NUMBER")

        _create_resident_notification(
            db,
            resident=resident,
            flat_number=normalized_flat,
            event_type="visitor_escalated",
            title="Visitor escalated to IVR",
            detail=f"{visitor.visitor_name} was escalated after no response within 30 seconds.",
            visitor_id=visitor.id,
        )

        db.commit()
        db.refresh(visitor)
        visitor_payload = _serialize_visitor(visitor)

    await ws_manager.broadcast(
        normalized_flat,
        {
            "event": "visitor_escalated",
            "visitor": visitor_payload.model_dump(mode="json"),
        },
    )

    if not phone_number:
        logger.error(
            "Escalation updated in DB but no resident phone found for visitor_id=%s", visitor_id
        )
        return

    await _trigger_ivr_call(phone_number, visitor)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Initialize database state and clean up background tasks on shutdown."""

    # Check DB availability up-front. When `AURAGATE_REQUIRE_DB_ON_STARTUP` is set
    # to a falsy value, we should not fail the process if the DB isn't reachable
    # yet (useful for first deploys while the DB plugin is still provisioning).
    db_ok, db_error = check_database_connection()

    if REQUIRE_DB_ON_STARTUP:
        if not db_ok:
            logger.error(
                "Database connectivity check failed during startup (driver=%s target=%s error=%s)",
                database_driver_name(),
                database_target_name(),
                db_error or "unknown",
            )
            raise RuntimeError("Database connectivity check failed during startup.")
        # DB is available and required — ensure schema and demo data exist.
        create_db_and_tables()
        _seed_demo_residents()
    else:
        # DB not required at startup: attempt initialization only when reachable.
        if db_ok:
            logger.info(
                "Database reachable during startup (driver=%s target=%s) — running init",
                database_driver_name(),
                database_target_name(),
            )
            try:
                create_db_and_tables()
                _seed_demo_residents()
            except Exception:
                logger.exception("Database init attempted but failed; continuing without DB init")
        else:
            logger.warning(
                "Skipping database initialization: AURAGATE_REQUIRE_DB_ON_STARTUP=false and DB is unreachable (error=%s)",
                db_error or "unknown",
            )
    yield
    for task in list(running_tasks):
        task.cancel()
    await asyncio.gather(*running_tasks, return_exceptions=True)


app = FastAPI(
    title="AuraGate Stateful Security API",
    version="2.0.0",
    description="Real-time visitor escalation flow with persistence, WebSockets, and IVR fallback.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Service and database liveness endpoint."""

    db_ok, _ = check_database_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "database_driver": database_driver_name(),
        "database_target": database_target_name(),
    }


@app.get("/api/health")
def api_health() -> dict[str, str]:
    """Alias health endpoint for frontend/api-path compatibility."""

    return health()


@app.post("/api/resident/auth/login", response_model=ResidentAuthResponse)
def resident_login(payload: ResidentAuthLoginRequest, db: Session = Depends(get_db)) -> ResidentAuthResponse:
    """Authenticate resident with flat number + PIN and create bearer session."""

    flat_number = _normalize_flat_number(payload.flat_number)
    resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()

    if resident is None:
        _seed_demo_residents()
        resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()

    if resident is None or not _verify_pin(payload.pin.strip(), resident.pin_salt, resident.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid flat number or PIN",
        )

    now = datetime.now(timezone.utc)
    existing_sessions = (
        db.query(models.ResidentSession)
        .filter(
            models.ResidentSession.resident_id == resident.id,
            models.ResidentSession.revoked_at.is_(None),
        )
        .all()
    )
    for existing in existing_sessions:
        existing.revoked_at = now

    token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(hours=RESIDENT_SESSION_TTL_HOURS)
    session = models.ResidentSession(
        resident_id=resident.id,
        token_hash=_hash_session_token(token),
        expires_at=expires_at,
        last_seen_at=now,
    )
    db.add(session)
    db.commit()

    return ResidentAuthResponse(
        access_token=token,
        expires_at=expires_at,
        resident=_serialize_resident(resident),
    )


@app.get("/api/resident/auth/session", response_model=ResidentSessionResponse)
def resident_session(
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> ResidentSessionResponse:
    """Validate resident session token and return resident identity context."""

    resident_id, session_id = auth_ids
    resident = db.get(models.Resident, resident_id)
    session = db.get(models.ResidentSession, session_id)

    if resident is None or session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session invalid")

    return ResidentSessionResponse(
        authenticated=True,
        expires_at=session.expires_at,
        resident=_serialize_resident(resident),
    )


@app.post("/api/resident/auth/logout", response_model=MessageResponse)
def resident_logout(
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Revoke current resident bearer session."""

    _, session_id = auth_ids
    session = db.get(models.ResidentSession, session_id)
    if session is not None and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()

    return MessageResponse(message="Logged out successfully")


@app.get("/api/resident/dashboard", response_model=ResidentDashboardResponse)
def get_resident_dashboard(
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> ResidentDashboardResponse:
    """Return resident dashboard data including pending approvals and missed notifications."""

    resident_id, _ = auth_ids
    resident = db.get(models.Resident, resident_id)
    if resident is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Resident account not found")

    pending_rows = (
        db.query(models.VisitorLog)
        .filter(
            models.VisitorLog.flat_number == resident.flat_number,
            models.VisitorLog.status == STATUS_PENDING,
        )
        .order_by(models.VisitorLog.timestamp.desc())
        .limit(20)
        .all()
    )
    recent_rows = (
        db.query(models.VisitorLog)
        .filter(models.VisitorLog.flat_number == resident.flat_number)
        .order_by(models.VisitorLog.timestamp.desc())
        .limit(50)
        .all()
    )
    notification_rows = (
        db.query(models.ResidentNotification)
        .filter(models.ResidentNotification.resident_id == resident.id)
        .order_by(models.ResidentNotification.created_at.desc())
        .limit(40)
        .all()
    )
    unread_count = (
        db.query(models.ResidentNotification)
        .filter(
            models.ResidentNotification.resident_id == resident.id,
            models.ResidentNotification.is_read.is_(False),
        )
        .count()
    )

    return ResidentDashboardResponse(
        resident=_serialize_resident(resident),
        pending_approvals=[_serialize_visitor(row) for row in pending_rows],
        unread_notifications=unread_count,
        notifications=[_serialize_notification(row) for row in notification_rows],
        recent_visitors=[_serialize_visitor(row) for row in recent_rows],
        settings=_serialize_resident_settings(resident),
    )


@app.get("/api/resident/notifications", response_model=ResidentNotificationsResponse)
def get_resident_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=200),
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> ResidentNotificationsResponse:
    """Return resident notifications and unread counts for missed-alert handling."""

    resident_id, _ = auth_ids
    base_query = db.query(models.ResidentNotification).filter(models.ResidentNotification.resident_id == resident_id)

    listing_query = base_query
    if unread_only:
        listing_query = listing_query.filter(models.ResidentNotification.is_read.is_(False))

    rows = listing_query.order_by(models.ResidentNotification.created_at.desc()).limit(limit).all()
    unread_count = base_query.filter(models.ResidentNotification.is_read.is_(False)).count()

    return ResidentNotificationsResponse(
        unread_count=unread_count,
        notifications=[_serialize_notification(row) for row in rows],
    )


@app.put(
    "/api/resident/notifications/{notification_id}/read",
    response_model=ResidentNotificationPayload,
)
def mark_notification_read(
    notification_id: uuid.UUID,
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> ResidentNotificationPayload:
    """Mark one resident notification as read."""

    resident_id, _ = auth_ids
    row = db.get(models.ResidentNotification, notification_id)
    if row is None or row.resident_id != resident_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    if not row.is_read:
        row.is_read = True
        row.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)

    return _serialize_notification(row)


@app.post("/api/resident/notifications/read-all", response_model=MessageResponse)
def mark_all_notifications_read(
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> MessageResponse:
    """Mark all resident notifications as read."""

    resident_id, _ = auth_ids
    now = datetime.now(timezone.utc)

    rows = (
        db.query(models.ResidentNotification)
        .filter(
            models.ResidentNotification.resident_id == resident_id,
            models.ResidentNotification.is_read.is_(False),
        )
        .all()
    )
    for row in rows:
        row.is_read = True
        row.read_at = now

    db.commit()
    return MessageResponse(message=f"Marked {len(rows)} notification(s) as read")


@app.get("/api/resident/settings", response_model=ResidentSettingsPayload)
def get_resident_settings(
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> ResidentSettingsPayload:
    """Return persisted resident notification/export settings."""

    resident_id, _ = auth_ids
    resident = db.get(models.Resident, resident_id)
    if resident is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Resident account not found")
    return _serialize_resident_settings(resident)


@app.put("/api/resident/settings", response_model=ResidentSettingsPayload)
def update_resident_settings(
    payload: ResidentSettingsUpdateRequest,
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> ResidentSettingsPayload:
    """Update resident dashboard settings."""

    resident_id, _ = auth_ids
    resident = db.get(models.Resident, resident_id)
    if resident is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Resident account not found")

    if payload.notify_push is not None:
        resident.notify_push = payload.notify_push
    if payload.notify_whatsapp is not None:
        resident.notify_whatsapp = payload.notify_whatsapp
    if payload.statement_preference is not None:
        resident.statement_preference = payload.statement_preference
    if payload.quiet_hours_start is not None:
        resident.quiet_hours_start = payload.quiet_hours_start.strip() or None
    if payload.quiet_hours_end is not None:
        resident.quiet_hours_end = payload.quiet_hours_end.strip() or None
    if payload.timezone_name is not None:
        resident.timezone_name = payload.timezone_name.strip() or "Asia/Kolkata"

    db.commit()
    db.refresh(resident)

    return _serialize_resident_settings(resident)


@app.get("/api/resident/visit-statement", response_model=None)
def resident_visit_statement(
    format: Literal["json", "csv"] = Query(default="json"),
    limit: int = Query(default=100, ge=1, le=500),
    auth_ids: tuple[uuid.UUID, uuid.UUID] = Depends(_require_resident_auth),
    db: Session = Depends(get_db),
) -> Any:
    """Export resident visit logs as statement-like JSON or CSV."""

    resident_id, _ = auth_ids
    resident = db.get(models.Resident, resident_id)
    if resident is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Resident account not found")

    rows = (
        db.query(models.VisitorLog)
        .filter(models.VisitorLog.flat_number == resident.flat_number)
        .order_by(models.VisitorLog.timestamp.desc())
        .limit(limit)
        .all()
    )
    visits = [_serialize_visitor(row) for row in rows]

    if format == "json":
        return ResidentVisitStatementResponse(
            generated_at=datetime.now(timezone.utc),
            flat_number=resident.flat_number,
            visits=visits,
        )

    csv_buffer = io.StringIO()
    writer = csv.DictWriter(
        csv_buffer,
        fieldnames=["id", "visitor_name", "visitor_type", "flat_number", "status", "timestamp"],
    )
    writer.writeheader()
    for row in visits:
        writer.writerow(
            {
                "id": str(row.id),
                "visitor_name": row.visitor_name,
                "visitor_type": row.visitor_type,
                "flat_number": row.flat_number,
                "status": row.status,
                "timestamp": row.timestamp.isoformat(),
            }
        )

    filename = f"auragate_statement_{resident.flat_number}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.post(
    "/api/visitors/check-in",
    response_model=VisitorMutationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def check_in_visitor(payload: VisitorCheckInRequest, db: Session = Depends(get_db)) -> VisitorMutationResponse:
    """Create visitor log, broadcast to resident, and schedule escalation watchdog."""

    flat_number = _normalize_flat_number(payload.flat_number)
    resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()
    if resident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No resident found for flat {flat_number}",
        )

    visitor_name = payload.visitor_name.strip()
    visitor_type = payload.visitor_type.strip()
    phone_number = _normalize_phone_number(payload.phone_number)
    anomaly_status = _detect_anomaly_status(db, phone_number, visitor_name, flat_number)
    initial_status = anomaly_status or STATUS_PENDING
    secret_seed = pyotp.random_base32() if pyotp is not None else None

    visitor = models.VisitorLog(
        visitor_name=visitor_name,
        visitor_type=visitor_type,
        flat_number=flat_number,
        phone_number=phone_number,
        image_payload=payload.image_payload,
        ocr_text=payload.image_ocr_text,
        secret_seed=secret_seed,
        status=initial_status,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    notification_title = "Visitor waiting at gate"
    notification_detail = f"{visitor.visitor_name} ({visitor.visitor_type}) requested entry."
    notification_event = "visitor_checked_in"

    if visitor.status == STATUS_HIGH_RISK_IDENTITY:
        notification_title = "High-risk identity collision"
        notification_detail = (
            f"{visitor.visitor_name} ({visitor.visitor_type}) is flagged: same phone used with different names."
        )
        notification_event = STATUS_HIGH_RISK_IDENTITY
    elif visitor.status == STATUS_HIGH_RISK_SCOUT:
        notification_title = "High-risk scout pattern"
        notification_detail = (
            f"{visitor.visitor_name} ({visitor.visitor_type}) is flagged: phone visited 3+ flats in 7 days."
        )
        notification_event = STATUS_HIGH_RISK_SCOUT

    _create_resident_notification(
        db,
        resident=resident,
        flat_number=flat_number,
        event_type=notification_event,
        title=notification_title,
        detail=notification_detail,
        visitor_id=visitor.id,
    )
    db.commit()

    visitor_payload = _serialize_visitor(visitor)

    await ws_manager.broadcast(
        visitor.flat_number,
        {
            "event": "visitor_checked_in",
            "visitor": visitor_payload.model_dump(mode="json"),
        },
    )

    await _broadcast_guard_event(
        "visitor_checked_in",
        visitor_payload,
        source="visitor_check_in",
    )

    _schedule_task(escalation_timer(visitor.id, visitor.flat_number))

    guest_qr_payload: dict[str, str] | None = None
    qr_valid_for_seconds: int | None = None
    qr_interval_seconds: int | None = None
    if visitor.secret_seed and pyotp is not None:
        qr_interval_seconds = 60
        qr_valid_for_seconds = qr_interval_seconds - (int(time.time()) % qr_interval_seconds)
        qr_totp = pyotp.TOTP(visitor.secret_seed, interval=qr_interval_seconds)
        guest_qr_payload = {
            "visitor_id": str(visitor.id),
            "totp": qr_totp.now(),
        }

    return VisitorMutationResponse(
        message="Visitor check-in recorded.",
        visitor=visitor_payload,
        guest_qr_payload=guest_qr_payload,
        qr_valid_for_seconds=qr_valid_for_seconds,
        qr_interval_seconds=qr_interval_seconds,
    )


@app.post(
    "/api/visitors/multi-flat",
    response_model=MultiFlatVisitorMutationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def check_in_multi_flat_visitor(
    payload: MultiFlatVisitorRequest,
    db: Session = Depends(get_db),
) -> MultiFlatVisitorMutationResponse:
    """Create one visitor record per flat and fan out notifications to all listed residents."""

    normalized_flats = [_normalize_flat_number(item) for item in payload.flat_numbers if item.strip()]
    unique_flats = list(dict.fromkeys(normalized_flats))

    if not unique_flats:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one flat is required")

    resident_rows = (
        db.query(models.Resident)
        .filter(models.Resident.flat_number.in_(unique_flats))
        .all()
    )
    resident_map = {row.flat_number: row for row in resident_rows}
    missing_flats = [flat for flat in unique_flats if flat not in resident_map]
    if missing_flats:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No resident found for flats: {', '.join(missing_flats)}",
        )

    visitor_name = payload.visitor_name.strip()
    visitor_type = payload.visitor_type.strip()
    phone_number = _normalize_phone_number(payload.phone_number)
    group_id = str(uuid.uuid4())

    created_rows: list[models.VisitorLog] = []
    for flat_number in unique_flats:
        row = models.VisitorLog(
            visitor_name=visitor_name,
            visitor_type=visitor_type,
            flat_number=flat_number,
            phone_number=phone_number,
            image_payload=payload.image_payload,
            ocr_text=payload.image_ocr_text,
            group_id=group_id,
            status=STATUS_PENDING,
        )
        db.add(row)
        created_rows.append(row)

    db.commit()
    for row in created_rows:
        db.refresh(row)

    for row in created_rows:
        _create_resident_notification(
            db,
            resident=resident_map.get(row.flat_number),
            flat_number=row.flat_number,
            event_type="visitor_checked_in",
            title="Multi-flat visitor waiting",
            detail=f"{row.visitor_name} ({row.visitor_type}) requested entry for grouped delivery.",
            visitor_id=row.id,
        )
    db.commit()

    payload_rows = [_serialize_visitor(row) for row in created_rows]
    for row_payload in payload_rows:
        await ws_manager.broadcast(
            row_payload.flat_number,
            {
                "event": "visitor_checked_in",
                "group_id": group_id,
                "visitor": row_payload.model_dump(mode="json"),
            },
        )
        await _broadcast_guard_event(
            "visitor_checked_in",
            row_payload,
            source="multi_flat_check_in",
            extra={"group_id": group_id},
        )
        _schedule_task(escalation_timer(row_payload.id, row_payload.flat_number))

    return MultiFlatVisitorMutationResponse(
        message="Multi-flat visitor check-in recorded.",
        group_id=group_id,
        visitors=payload_rows,
    )


@app.get("/api/visitors/history", response_model=VisitorHistoryResponse)
def get_visitor_history(
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
) -> VisitorHistoryResponse:
    """Return recent visitor records for admin analytics and audit display."""

    rows = (
        db.query(models.VisitorLog)
        .order_by(models.VisitorLog.timestamp.desc())
        .limit(limit)
        .all()
    )
    return VisitorHistoryResponse(visitors=[_serialize_visitor(row) for row in rows])


@app.put("/api/visitors/{visitor_id}/approve", response_model=VisitorMutationResponse)
async def approve_visitor(visitor_id: uuid.UUID, db: Session = Depends(get_db)) -> VisitorMutationResponse:
    """Approve a pending visitor entry before escalation timeout expires."""

    visitor = db.get(models.VisitorLog, visitor_id)
    if visitor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visitor not found")

    if visitor.status == STATUS_APPROVED:
        visitor_payload = _serialize_visitor(visitor)
        return VisitorMutationResponse(message="Visitor was already approved.", visitor=visitor_payload)

    resident = (
        db.query(models.Resident)
        .filter(models.Resident.flat_number == visitor.flat_number)
        .first()
    )

    visitor.status = STATUS_APPROVED
    _create_resident_notification(
        db,
        resident=resident,
        flat_number=visitor.flat_number,
        event_type="visitor_approved",
        title="Visitor approved",
        detail=f"You approved {visitor.visitor_name} for entry.",
        visitor_id=visitor.id,
    )

    auto_approved_rows: list[models.VisitorLog] = []
    if visitor.group_id:
        auto_approved_rows = (
            db.query(models.VisitorLog)
            .filter(
                models.VisitorLog.group_id == visitor.group_id,
                models.VisitorLog.id != visitor.id,
                models.VisitorLog.status != STATUS_APPROVED,
            )
            .all()
        )
        for sibling in auto_approved_rows:
            sibling.status = STATUS_APPROVED
            sibling_resident = (
                db.query(models.Resident)
                .filter(models.Resident.flat_number == sibling.flat_number)
                .first()
            )
            _create_resident_notification(
                db,
                resident=sibling_resident,
                flat_number=sibling.flat_number,
                event_type="visitor_approved",
                title="Visitor auto-approved",
                detail=(
                    f"{sibling.visitor_name} was auto-approved because a grouped delivery was approved by another resident."
                ),
                visitor_id=sibling.id,
            )

    db.commit()
    db.refresh(visitor)
    visitor_payload = _serialize_visitor(visitor)

    await ws_manager.broadcast(
        visitor.flat_number,
        {
            "event": "visitor_approved",
            "visitor": visitor_payload.model_dump(mode="json"),
        },
    )
    await _broadcast_guard_event(
        "visitor_approved",
        visitor_payload,
        source="resident_approval",
    )

    for sibling in auto_approved_rows:
        db.refresh(sibling)
        sibling_payload = _serialize_visitor(sibling)
        await ws_manager.broadcast(
            sibling.flat_number,
            {
                "event": "visitor_approved",
                "group_id": sibling.group_id,
                "visitor": sibling_payload.model_dump(mode="json"),
            },
        )
        await _broadcast_guard_event(
            "visitor_approved",
            sibling_payload,
            source="resident_approval_group",
            extra={"group_id": sibling.group_id},
        )

    if auto_approved_rows:
        message = f"Visitor approved successfully. Auto-approved {len(auto_approved_rows)} grouped visitor(s)."
    else:
        message = "Visitor approved successfully."
    return VisitorMutationResponse(message=message, visitor=visitor_payload)


@app.get("/api/guard/totp", response_model=GuardTotpResponse)
def get_guard_totp() -> GuardTotpResponse:
    """Return a TOTP secret and current code for rendering guard QR workflow."""
    if pyotp is None:
        # Fallback when pyotp is not installed (tests/CI): return a stubbed response
        valid_for_seconds = TOTP_INTERVAL_SECONDS - (int(time.time()) % TOTP_INTERVAL_SECONDS)
        return GuardTotpResponse(
            secret=GUARD_TOTP_SECRET,
            otp_auth_uri="",
            current_otp="000000",
            valid_for_seconds=valid_for_seconds,
            interval_seconds=TOTP_INTERVAL_SECONDS,
        )

    totp = pyotp.TOTP(GUARD_TOTP_SECRET, interval=TOTP_INTERVAL_SECONDS)
    otp_uri = totp.provisioning_uri(
        name=f"{DEMO_SOCIETY_NAME} Guard Device",
        issuer_name="AuraGate",
    )
    valid_for_seconds = TOTP_INTERVAL_SECONDS - (int(time.time()) % TOTP_INTERVAL_SECONDS)

    return GuardTotpResponse(
        secret=GUARD_TOTP_SECRET,
        otp_auth_uri=otp_uri,
        current_otp=totp.now(),
        valid_for_seconds=valid_for_seconds,
        interval_seconds=TOTP_INTERVAL_SECONDS,
    )


@app.get("/api/totp/generate", response_model=InviteTotpResponse)
def generate_invite_totp(
    guest_name: str = Query(default="Guest Pass", min_length=1, max_length=120),
    flat_number: str = Query(default="T4-402", min_length=1, max_length=32),
    db: Session = Depends(get_db),
) -> InviteTotpResponse:
    """Generate and persist a visitor-scoped TOTP seed for expected guest verification."""

    if pyotp is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="TOTP service unavailable")

    invite_interval_seconds = 60
    valid_for_seconds = invite_interval_seconds - (int(time.time()) % invite_interval_seconds)
    normalized_flat = _normalize_flat_number(flat_number)

    resident = db.query(models.Resident).filter(models.Resident.flat_number == normalized_flat).first()
    if resident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No resident found for flat {normalized_flat}")

    guest_label = guest_name.strip() or "Guest Pass"

    secret_seed = pyotp.random_base32()
    totp = pyotp.TOTP(secret_seed, interval=invite_interval_seconds)
    current_otp = totp.now()
    provisioned_uri = totp.provisioning_uri(name=guest_label, issuer_name="AuraGate Invite")

    visitor = models.VisitorLog(
        visitor_name=guest_label,
        visitor_type="Expected Guest",
        flat_number=normalized_flat,
        status=STATUS_PENDING,
        secret_seed=secret_seed,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    return InviteTotpResponse(
        visitor_id=str(visitor.id),
        secret_seed=secret_seed,
        provisioned_uri=provisioned_uri,
        secret=secret_seed,
        current_otp=current_otp,
        valid_for_seconds=valid_for_seconds,
        interval_seconds=invite_interval_seconds,
    )


@app.post("/api/visitors/verify-totp", response_model=VerifyVisitorTotpResponse)
async def verify_visitor_totp(
    payload: VerifyVisitorTotpRequest,
    db: Session = Depends(get_db),
) -> VerifyVisitorTotpResponse:
    """Verify expected-guest TOTP using stored visitor seed and approve on success."""

    if pyotp is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="TOTP service unavailable")

    try:
        visitor_uuid = uuid.UUID(payload.visitor_id.strip())
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid visitor_id") from exc

    visitor = db.get(models.VisitorLog, visitor_uuid)
    if visitor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visitor not found")

    if not visitor.secret_seed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Visitor does not have a provisioned TOTP seed")

    scanned_code = payload.scanned_code.strip()
    if len(scanned_code) != 6 or not scanned_code.isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scanned_code must be a 6-digit number")

    totp = pyotp.TOTP(visitor.secret_seed, interval=60)
    is_valid = totp.verify(scanned_code)

    if not is_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired pass")

    visitor.status = STATUS_APPROVED

    resident = db.query(models.Resident).filter(models.Resident.flat_number == visitor.flat_number).first()

    _create_resident_notification(
        db,
        resident=resident,
        flat_number=visitor.flat_number,
        event_type="visitor_approved",
        title="Expected guest approved at gate",
        detail=f"{visitor.visitor_name} was approved after successful TOTP verification.",
        visitor_id=visitor.id,
    )
    db.commit()
    db.refresh(visitor)

    visitor_payload = _serialize_visitor(visitor)
    await ws_manager.broadcast(
        visitor.flat_number,
        {
            "event": "visitor_approved",
            "visitor": visitor_payload.model_dump(mode="json"),
        },
    )
    await _broadcast_guard_event(
        "visitor_approved",
        visitor_payload,
        source="guard_qr_verification",
    )

    return VerifyVisitorTotpResponse(success=True, status="APPROVED")


@app.post(
    "/api/visitors/unplanned",
    response_model=VisitorMutationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_unplanned_visitor(
    payload: UnplannedVisitorRequest,
    db: Session = Depends(get_db),
) -> VisitorMutationResponse:
    """Create an unplanned visitor entry from guard kiosk category shortcuts."""

    flat_number = _normalize_flat_number(payload.flat_number)
    resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()
    if resident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No resident found for flat {flat_number}",
        )

    default_name = {
        "Delivery": "Unplanned Delivery",
        "Maid": "Unplanned Maid",
        "Staff": "Unplanned Daily Staff",
        "Unknown": "Unknown Visitor",
    }[payload.category]

    visitor_type = {
        "Delivery": "Delivery",
        "Maid": "Maid",
        "Staff": "Staff",
        "Unknown": "Unknown",
    }[payload.category]

    visitor_name = payload.visitor_name.strip() if payload.visitor_name else default_name
    phone_number = _normalize_phone_number(payload.phone_number)
    anomaly_status = _detect_anomaly_status(db, phone_number, visitor_name, flat_number)
    initial_status = anomaly_status or STATUS_PENDING

    visitor = models.VisitorLog(
        visitor_name=visitor_name,
        visitor_type=visitor_type,
        flat_number=flat_number,
        phone_number=phone_number,
        image_payload=payload.image_payload,
        ocr_text=payload.image_ocr_text,
        status=initial_status,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    notification_title = "Unplanned visitor waiting"
    notification_detail = f"{visitor.visitor_name} ({visitor.visitor_type}) was checked in from guard quick action."
    notification_event = "visitor_checked_in"

    if visitor.status == STATUS_HIGH_RISK_IDENTITY:
        notification_title = "High-risk identity collision"
        notification_detail = (
            f"{visitor.visitor_name} ({visitor.visitor_type}) is flagged: same phone used with different names."
        )
        notification_event = STATUS_HIGH_RISK_IDENTITY
    elif visitor.status == STATUS_HIGH_RISK_SCOUT:
        notification_title = "High-risk scout pattern"
        notification_detail = (
            f"{visitor.visitor_name} ({visitor.visitor_type}) is flagged: phone visited 3+ flats in 7 days."
        )
        notification_event = STATUS_HIGH_RISK_SCOUT

    _create_resident_notification(
        db,
        resident=resident,
        flat_number=flat_number,
        event_type=notification_event,
        title=notification_title,
        detail=notification_detail,
        visitor_id=visitor.id,
    )
    db.commit()

    visitor_payload = _serialize_visitor(visitor)

    await ws_manager.broadcast(
        visitor.flat_number,
        {
            "event": "visitor_checked_in",
            "visitor": visitor_payload.model_dump(mode="json"),
        },
    )

    await _broadcast_guard_event(
        "visitor_checked_in",
        visitor_payload,
        source="unplanned_check_in",
    )

    _schedule_task(escalation_timer(visitor.id, visitor.flat_number))

    return VisitorMutationResponse(
        message=f"Unplanned {visitor_type} entry recorded.",
        visitor=visitor_payload,
    )


@app.post("/api/emergency/sos", response_model=VisitorMutationResponse)
async def trigger_emergency_sos(
    payload: EmergencySOSRequest,
    db: Session = Depends(get_db),
) -> VisitorMutationResponse:
    """Trigger emergency SOS event and fan out high-priority alert to resident/admin/guard channels."""

    flat_number = _normalize_flat_number(payload.flat_number)
    resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()
    if resident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No resident found for flat {flat_number}")

    visitor = models.VisitorLog(
        visitor_name=f"SOS-{payload.source}",
        visitor_type="EMERGENCY",
        flat_number=flat_number,
        status=STATUS_APPROVED,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    _create_resident_notification(
        db,
        resident=resident,
        flat_number=flat_number,
        event_type="sos_alert",
        title="Emergency SOS triggered",
        detail=f"Emergency source={payload.source} reported for your flat.",
        visitor_id=visitor.id,
    )
    db.commit()

    visitor_payload = _serialize_visitor(visitor)
    sos_payload = {
        "event": "sos_alert",
        "priority": "high",
        "source": payload.source,
        "flat_number": flat_number,
        "visitor": visitor_payload.model_dump(mode="json"),
    }

    await ws_manager.broadcast(flat_number, sos_payload)
    await admin_ws_manager.broadcast("admin", sos_payload)
    await guard_ws_manager.broadcast("guard", sos_payload)

    return VisitorMutationResponse(
        message="Emergency SOS broadcasted.",
        visitor=visitor_payload,
    )


@app.websocket("/ws/resident/{flat_number}")
async def resident_socket(websocket: WebSocket, flat_number: str) -> None:
    """Resident real-time channel for new check-ins and status updates."""

    normalized_flat = _normalize_flat_number(flat_number)
    await ws_manager.connect(normalized_flat, websocket)
    await websocket.send_json({"event": "connected", "flat_number": normalized_flat})

    try:
        while True:
            message = await websocket.receive_text()
            if message.lower() == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        await ws_manager.disconnect(normalized_flat, websocket)


@app.websocket("/ws/admin")
async def admin_socket(websocket: WebSocket) -> None:
    """Admin real-time channel for operational alerts such as SOS fan-out."""

    channel_key = "admin"
    await admin_ws_manager.connect(channel_key, websocket)
    await websocket.send_json({"event": "connected", "channel": channel_key})

    try:
        while True:
            message = await websocket.receive_text()
            if message.lower() == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        await admin_ws_manager.disconnect(channel_key, websocket)


@app.websocket("/ws/guard")
async def guard_socket(websocket: WebSocket) -> None:
    """Guard real-time channel for SOS and visitor lifecycle approval updates."""

    channel_key = "guard"
    await guard_ws_manager.connect(channel_key, websocket)
    await websocket.send_json({"event": "connected", "channel": channel_key})

    try:
        while True:
            message = await websocket.receive_text()
            if message.lower() == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        await guard_ws_manager.disconnect(channel_key, websocket)


@app.post("/api/escalate")
async def escalate(request: EscalateRequest, db: Session = Depends(get_db)) -> dict:
    flat_number = _normalize_flat_number(request.flat_number)
    resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()
    phone_number = resident.phone_number if resident and resident.phone_number else os.getenv("TO_PHONE_NUMBER")
    if not phone_number:
        raise HTTPException(status_code=400, detail="No phone number configured for resident or fallback")

    # record an escalation row (optional but useful for auditing)
    visitor = models.VisitorLog(
        visitor_name=f"Escalation: {request.visitor_type}",
        visitor_type=request.visitor_type,
        flat_number=flat_number,
        status=STATUS_ESCALATED_IVR,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    _create_resident_notification(
        db,
        resident=resident,
        flat_number=flat_number,
        event_type="visitor_escalated",
        title="Escalation triggered",
        detail=f"Escalation triggered for {request.visitor_type} at your flat.",
        visitor_id=visitor.id,
    )
    db.commit()

    # notify any connected residents in real time
    visitor_payload = _serialize_visitor(visitor)
    await ws_manager.broadcast(
        flat_number,
        {"event": "visitor_escalated", "visitor": visitor_payload.model_dump(mode="json")},
    )

    # trigger IVR
    call_sid = await _trigger_ivr_call(phone_number, visitor)
    if not call_sid:
        return {"success": False, "message": "Failed to trigger IVR Call"}
    return {"success": True, "message": "IVR Call Triggered to Resident"}


@app.post("/api/ivr/callback")
async def ivr_callback(request: Request, db: Session = Depends(get_db)) -> Response:
    """Handle IVR Gather callbacks from Twilio.

    Expects a POST with form-encoded fields. The `Digits` form field is used to
    determine the resident response. We accept an optional `visitor_id` query
    parameter (preferred). If `Digits == '1'`, mark the visitor as approved and
    broadcast a `visitor_approved` websocket event.
    """

    form = await request.form()
    digits = (form.get("Digits") or form.get("digits") or "").strip()
    visitor_id_q = request.query_params.get("visitor_id")

    logger.info("IVR callback received visitor_id=%s Digits=%s form_keys=%s", visitor_id_q, digits, list(form.keys()))

    visitor = None
    if visitor_id_q:
        try:
            vid = uuid.UUID(visitor_id_q)
            visitor = db.get(models.VisitorLog, vid)
        except Exception:
            visitor = None

    if visitor is None:
        # Try to resolve by destination phone (To) -> resident -> most recent escalated visitor
        to_phone = (form.get("To") or form.get("to") or "").strip() or None
        if to_phone:
            resident = db.query(models.Resident).filter(models.Resident.phone_number == to_phone).first()
            if resident is not None:
                visitor = (
                    db.query(models.VisitorLog)
                    .filter(models.VisitorLog.flat_number == resident.flat_number, models.VisitorLog.status == STATUS_ESCALATED_IVR)
                    .order_by(models.VisitorLog.timestamp.desc())
                    .first()
                )

    if visitor is None:
        # Fallback: pick the most recent escalated visitor across flats
        visitor = (
            db.query(models.VisitorLog)
            .filter(models.VisitorLog.status == STATUS_ESCALATED_IVR)
            .order_by(models.VisitorLog.timestamp.desc())
            .first()
        )

    if visitor is None:
        xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say voice=\"alice\">No matching visitor record found. Goodbye.</Say></Response>"
        return Response(content=xml, media_type="application/xml")

    # Only handle the approval digit '1' here. Other digits are ignored but
    # can be extended to support denial or other actions.
    if digits == "1":
        if visitor.status != STATUS_APPROVED:
            resident = (
                db.query(models.Resident)
                .filter(models.Resident.flat_number == visitor.flat_number)
                .first()
            )

            visitor.status = STATUS_APPROVED
            _create_resident_notification(
                db,
                resident=resident,
                flat_number=visitor.flat_number,
                event_type="visitor_approved",
                title="Visitor approved",
                detail=f"You approved {visitor.visitor_name} via IVR.",
                visitor_id=visitor.id,
            )

            auto_approved_rows: list[models.VisitorLog] = []
            if visitor.group_id:
                auto_approved_rows = (
                    db.query(models.VisitorLog)
                    .filter(
                        models.VisitorLog.group_id == visitor.group_id,
                        models.VisitorLog.id != visitor.id,
                        models.VisitorLog.status != STATUS_APPROVED,
                    )
                    .all()
                )
                for sibling in auto_approved_rows:
                    sibling.status = STATUS_APPROVED
                    sibling_resident = (
                        db.query(models.Resident)
                        .filter(models.Resident.flat_number == sibling.flat_number)
                        .first()
                    )
                    _create_resident_notification(
                        db,
                        resident=sibling_resident,
                        flat_number=sibling.flat_number,
                        event_type="visitor_approved",
                        title="Visitor auto-approved",
                        detail=(
                            f"{sibling.visitor_name} was auto-approved because a grouped delivery was approved by another resident."
                        ),
                        visitor_id=sibling.id,
                    )

            db.commit()
            db.refresh(visitor)
            visitor_payload = _serialize_visitor(visitor)

            # Notify the resident channel via WebSocket
            await ws_manager.broadcast(
                visitor.flat_number,
                {
                    "event": "visitor_approved",
                    "visitor": visitor_payload.model_dump(mode="json"),
                },
            )

            # Notify guard channel
            await _broadcast_guard_event(
                "visitor_approved",
                visitor_payload,
                source="ivr_approval",
            )

            for sibling in auto_approved_rows:
                db.refresh(sibling)
                sibling_payload = _serialize_visitor(sibling)
                await ws_manager.broadcast(
                    sibling.flat_number,
                    {
                        "event": "visitor_approved",
                        "group_id": sibling.group_id,
                        "visitor": sibling_payload.model_dump(mode="json"),
                    },
                )
                await _broadcast_guard_event(
                    "visitor_approved",
                    sibling_payload,
                    source="ivr_approval_group",
                    extra={"group_id": sibling.group_id},
                )

        xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say voice=\"alice\">Thank you. Visitor approved. Goodbye.</Say></Response>"
        return Response(content=xml, media_type="application/xml")

    # Non-approval digits: respond politely but do not change DB state.
    xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say voice=\"alice\">No action taken. Goodbye.</Say></Response>"
    return Response(content=xml, media_type="application/xml")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
