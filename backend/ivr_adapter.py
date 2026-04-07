#!/usr/bin/env python3
"""IVR adapter abstraction for provider-swappable IVR/voice providers.

Provide a small scaffold used by tests (NoopAdapter) and a TwilioAdapter
stub for future wiring. Use `get_adapter()` to pick an implementation based
on `IVR_ADAPTER` env or available credentials.
"""

import os
import asyncio
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class IVRAdapter(ABC):
    @abstractmethod
    async def trigger_call(self, to_phone: str, twiml: str) -> Dict[str, Any]:
        raise NotImplementedError


class NoopAdapter(IVRAdapter):
    async def trigger_call(self, to_phone: str, twiml: str) -> Dict[str, Any]:
        return {"sid": "noop-000", "status": "noop"}


class TwilioAdapter(IVRAdapter):
    def __init__(self, account_sid: Optional[str] = None, auth_token: Optional[str] = None, from_phone: Optional[str] = None):
        self.account_sid = account_sid or os.getenv("TWILIO_ACCOUNT_SID")
        self.auth_token = auth_token or os.getenv("TWILIO_AUTH_TOKEN")
        # Keep backward compatibility with older env var naming while aligning
        # with the documented `TWILIO_PHONE_NUMBER` key.
        self.from_phone = from_phone or os.getenv("TWILIO_PHONE_NUMBER") or os.getenv("TWILIO_FROM_NUMBER")

    async def trigger_call(self, to_phone: str, twiml: str) -> Dict[str, Any]:
        try:
            from twilio.rest import Client
        except Exception as exc:
            raise RuntimeError("Twilio SDK not available") from exc

        def _sync_call():
            client = Client(self.account_sid, self.auth_token)
            call = client.calls.create(twiml=twiml, to=to_phone, from_=self.from_phone)
            return {"sid": getattr(call, "sid", None), "status": getattr(call, "status", None)}

        return await asyncio.to_thread(_sync_call)


def get_adapter(adapter_name: Optional[str] = None) -> IVRAdapter:
    name = (adapter_name or os.getenv("IVR_ADAPTER", "")).lower()
    if name == "noop":
        return NoopAdapter()
    if name == "twilio":
        return TwilioAdapter()
    if not os.getenv("TWILIO_ACCOUNT_SID"):
        return NoopAdapter()
    return TwilioAdapter()


__all__ = ["IVRAdapter", "NoopAdapter", "TwilioAdapter", "get_adapter"]
