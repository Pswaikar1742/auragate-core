"""SQLAlchemy data models for AuraGate entities."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
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
    phone_number: Mapped[str] = mapped_column(String(24), nullable=False)

    visitor_logs: Mapped[list["VisitorLog"]] = relationship(back_populates="resident")


class VisitorLog(Base):
    """Stores every visitor check-in and final decision state."""

    __tablename__ = "visitor_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visitor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    visitor_type: Mapped[str] = mapped_column(String(32), nullable=False)
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
