"""AuraGate stateful backend with DB persistence, WebSockets, and async escalation tasks."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import pyotp
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from twilio.base.exceptions import TwilioException
from twilio.rest import Client

try:
    from . import models
    from .database import SessionLocal, create_db_and_tables, get_db
except ImportError:
    import models
    from database import SessionLocal, create_db_and_tables, get_db

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("auragate")

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"
STATUS_ESCALATED_IVR = "escalated_ivr"

DEMO_SOCIETY_NAME = os.getenv("AURAGATE_SOCIETY_NAME", "Prestige Falcon City, Tower 4")
GUARD_TOTP_SECRET = os.getenv("GUARD_TOTP_SECRET", pyotp.random_base32())
TOTP_INTERVAL_SECONDS = 30


class VisitorCheckInRequest(BaseModel):
    """Guard tablet payload for registering a new visitor."""

    visitor_name: str = Field(..., min_length=1, max_length=120)
    visitor_type: str = Field(..., min_length=1, max_length=32)
    flat_number: str = Field(..., min_length=1, max_length=32)


class VisitorPayload(BaseModel):
    """Public visitor representation shared over API and WebSocket."""

    id: uuid.UUID
    visitor_name: str
    visitor_type: str
    flat_number: str
    status: str
    timestamp: datetime


class VisitorMutationResponse(BaseModel):
    """Response returned after check-in and approve actions."""

    message: str
    visitor: VisitorPayload


class GuardTotpResponse(BaseModel):
    """TOTP payload consumed by guard UI for QR rendering."""

    secret: str
    otp_auth_uri: str
    current_otp: str
    valid_for_seconds: int
    interval_seconds: int


class EscalateRequest(BaseModel):
    """Request model for explicit escalation trigger."""

    flat_number: str = Field(..., min_length=1, max_length=32)
    visitor_type: str = Field(..., min_length=1, max_length=32)
    status: str = Field(default="timeout")


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
running_tasks: set[asyncio.Task[None]] = set()


def _serialize_visitor(visitor: models.VisitorLog) -> VisitorPayload:
    """Convert ORM model into typed response payload."""

    return VisitorPayload(
        id=visitor.id,
        visitor_name=visitor.visitor_name,
        visitor_type=visitor.visitor_type,
        flat_number=visitor.flat_number,
        status=visitor.status,
        timestamp=visitor.timestamp,
    )


def _schedule_task(coro: asyncio.Future[Any] | asyncio.Task[Any] | Any) -> None:
    """Track background task lifecycle to avoid orphaned tasks on shutdown."""

    task = asyncio.create_task(coro)
    running_tasks.add(task)
    task.add_done_callback(lambda finished: running_tasks.discard(finished))


def _twilio_message(visitor_name: str, visitor_type: str, flat_number: str) -> str:
    """Generate a clear IVR message for resident escalation call."""

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<Response>"
        "<Say voice=\"alice\">"
        f"Alert from AuraGate at {DEMO_SOCIETY_NAME}. "
        f"{visitor_type} visitor {visitor_name} is waiting at the gate for flat {flat_number}. "
        "Press 1 to approve."
        "</Say>"
        "</Response>"
    )


async def _trigger_twilio_call(phone_number: str, visitor: models.VisitorLog) -> str | None:
    """Place a Twilio voice call; returns Call SID on success."""

    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_phone = os.getenv("TWILIO_PHONE_NUMBER")

    missing = [
        key
        for key, value in (
            ("TWILIO_ACCOUNT_SID", account_sid),
            ("TWILIO_AUTH_TOKEN", auth_token),
            ("TWILIO_PHONE_NUMBER", from_phone),
        )
        if not value
    ]
    if missing:
        logger.error("Cannot call Twilio. Missing env vars: %s", ", ".join(missing))
        return None

    twiml = _twilio_message(visitor.visitor_name, visitor.visitor_type, visitor.flat_number)
    client = Client(account_sid, auth_token)

    try:
        call = await run_in_threadpool(
            client.calls.create,
            to=phone_number,
            from_=from_phone,
            twiml=twiml,
        )
    except TwilioException as exc:
        logger.exception("Twilio escalation failed for visitor_id=%s: %s", visitor.id, exc)
        return None

    logger.info("Twilio call triggered for visitor_id=%s, call_sid=%s", visitor.id, call.sid)
    return call.sid


def _seed_demo_residents() -> None:
    """Create demo resident rows if they do not exist."""

    demo_phone = os.getenv("TO_PHONE_NUMBER")
    if not demo_phone:
        logger.warning("TO_PHONE_NUMBER is not set. Demo residents were not auto-seeded.")
        return

    with SessionLocal() as db:
        for flat_number in ("T4-401", "T4-402"):
            existing = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()
            if not existing:
                db.add(models.Resident(flat_number=flat_number, phone_number=demo_phone))
        db.commit()


async def escalation_timer(visitor_id: uuid.UUID, flat_number: str) -> None:
    """Escalate unresolved visitor requests to IVR call after timeout."""

    await asyncio.sleep(30)

    with SessionLocal() as db:
        visitor = db.get(models.VisitorLog, visitor_id)
        if visitor is None:
            logger.warning("Escalation skipped: visitor_id=%s not found", visitor_id)
            return

        if visitor.status != STATUS_PENDING:
            logger.info("Escalation skipped: visitor_id=%s already resolved (%s)", visitor_id, visitor.status)
            return

        visitor.status = STATUS_ESCALATED_IVR

        resident = db.query(models.Resident).filter(models.Resident.flat_number == flat_number).first()
        phone_number = resident.phone_number if resident else os.getenv("TO_PHONE_NUMBER")

        db.commit()
        db.refresh(visitor)
        visitor_payload = _serialize_visitor(visitor)

    await ws_manager.broadcast(
        flat_number,
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

    await _trigger_twilio_call(phone_number, visitor)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Initialize database state and clean up background tasks on shutdown."""

    create_db_and_tables()
    _seed_demo_residents()
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
    """Simple service liveness endpoint."""

    return {"status": "ok"}


@app.post(
    "/api/visitors/check-in",
    response_model=VisitorMutationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def check_in_visitor(payload: VisitorCheckInRequest, db: Session = Depends(get_db)) -> VisitorMutationResponse:
    """Create visitor log, broadcast to resident, and schedule escalation watchdog."""

    resident = db.query(models.Resident).filter(models.Resident.flat_number == payload.flat_number).first()
    if resident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No resident found for flat {payload.flat_number}",
        )

    visitor = models.VisitorLog(
        visitor_name=payload.visitor_name.strip(),
        visitor_type=payload.visitor_type.strip(),
        flat_number=payload.flat_number.strip(),
        status=STATUS_PENDING,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    visitor_payload = _serialize_visitor(visitor)

    await ws_manager.broadcast(
        visitor.flat_number,
        {
            "event": "visitor_checked_in",
            "visitor": visitor_payload.model_dump(mode="json"),
        },
    )

    _schedule_task(escalation_timer(visitor.id, visitor.flat_number))

    return VisitorMutationResponse(message="Visitor check-in recorded.", visitor=visitor_payload)


@app.put("/api/visitors/{visitor_id}/approve", response_model=VisitorMutationResponse)
async def approve_visitor(visitor_id: uuid.UUID, db: Session = Depends(get_db)) -> VisitorMutationResponse:
    """Approve a pending visitor entry before escalation timeout expires."""

    visitor = db.get(models.VisitorLog, visitor_id)
    if visitor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visitor not found")

    if visitor.status == STATUS_APPROVED:
        visitor_payload = _serialize_visitor(visitor)
        return VisitorMutationResponse(message="Visitor was already approved.", visitor=visitor_payload)

    visitor.status = STATUS_APPROVED
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

    return VisitorMutationResponse(message="Visitor approved successfully.", visitor=visitor_payload)


@app.get("/api/guard/totp", response_model=GuardTotpResponse)
def get_guard_totp() -> GuardTotpResponse:
    """Return a TOTP secret and current code for rendering guard QR workflow."""

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


@app.websocket("/ws/resident/{flat_number}")
async def resident_socket(websocket: WebSocket, flat_number: str) -> None:
    """Resident real-time channel for new check-ins and status updates."""

    await ws_manager.connect(flat_number, websocket)
    await websocket.send_json({"event": "connected", "flat_number": flat_number})

    try:
        while True:
            message = await websocket.receive_text()
            if message.lower() == "ping":
                await websocket.send_json({"event": "pong"})
    except WebSocketDisconnect:
        await ws_manager.disconnect(flat_number, websocket)
    class EscalateRequest(BaseModel):
        flat_number: str
        visitor_type: str
        status: str = "timeout"


@app.post("/api/escalate")
async def escalate(request: EscalateRequest, db: Session = Depends(get_db)) -> dict:
    resident = db.query(models.Resident).filter(models.Resident.flat_number == request.flat_number).first()
    phone_number = resident.phone_number if resident else os.getenv("TO_PHONE_NUMBER")
    if not phone_number:
        raise HTTPException(status_code=400, detail="No phone number configured for resident or fallback")

    # record an escalation row (optional but useful for auditing)
    visitor = models.VisitorLog(
        visitor_name=f"Escalation: {request.visitor_type}",
        visitor_type=request.visitor_type,
        flat_number=request.flat_number,
        status=STATUS_ESCALATED_IVR,
    )
    db.add(visitor)
    db.commit()
    db.refresh(visitor)

    # notify any connected residents in real time
    visitor_payload = _serialize_visitor(visitor)
    await ws_manager.broadcast(
        request.flat_number,
        {"event": "visitor_escalated", "visitor": visitor_payload.model_dump(mode="json")},
    )

    # trigger IVR
    call_sid = await _trigger_twilio_call(phone_number, visitor)
    if not call_sid:
        return {"success": False, "message": "Failed to trigger IVR Call"}
    return {"success": True, "message": "IVR Call Triggered to Resident"}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
