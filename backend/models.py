"""SQLAlchemy data models for AuraGate entities."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

try:
    from .database import Base
except ImportError:
    from database import Base


class Resident(Base):
    """Resident profile used for escalation routing."""

    __tablename__ = "residents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    flat_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    phone_number: Mapped[str] = mapped_column(String(24), nullable=False, default="")

    # Additional profile fields used by the API
    resident_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    pin_salt: Mapped[str] = mapped_column(String(128), nullable=True)
    pin_hash: Mapped[str] = mapped_column(String(256), nullable=True)
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=True)
    statement_preference: Mapped[str] = mapped_column(String(8), nullable=False, default="csv")
    notify_push: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notify_whatsapp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    visitor_logs: Mapped[list["VisitorLog"]] = relationship(back_populates="resident")


class ResidentSession(Base):
    """Resident session tokens for bearer auth."""

    __tablename__ = "resident_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("residents.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)


class ResidentNotification(Base):
    """Resident notification rows for missed-alert tracking."""

    __tablename__ = "resident_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("residents.id"), nullable=False)
    flat_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    visitor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)


class VisitorLog(Base):
    """Stores every visitor check-in and final decision state."""

    __tablename__ = "visitor_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visitor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    visitor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(24), nullable=True)
    image_payload: Mapped[str] = mapped_column(Text, nullable=True)
    secret_seed: Mapped[str] = mapped_column(String(128), nullable=True)
    group_id: Mapped[str] = mapped_column(String(64), nullable=True)

    flat_number: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("residents.flat_number", onupdate="CASCADE", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    resident: Mapped[Resident] = relationship(back_populates="visitor_logs")
