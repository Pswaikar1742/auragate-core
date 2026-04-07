#!/usr/bin/env python3
"""Integration Golden-Thread runner (HTTP + WebSocket).

Assumes a backend is running at http://localhost:8000 with environment
variables set: `IVR_ADAPTER=noop` and `TO_PHONE_NUMBER` (to seed demo residents).

Install dependencies for the runner in your environment before running:

    pip install httpx websockets

Run:

    python integration/run_golden_thread.py

Exits 0 on success, non-zero on failure.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import httpx
import websockets
from datetime import datetime, timezone

BASE = os.getenv("GOLDEN_THREAD_BASE", "http://localhost:8000")
WS_BASE = BASE.replace("http", "ws")
FLAT = os.getenv("GOLDEN_THREAD_FLAT", "T4-401")


async def wait_for_health(client: httpx.AsyncClient, timeout: int = 30) -> bool:
    for _ in range(timeout):
        try:
            r = await client.get("/health")
            if r.status_code == 200:
                return True
        except Exception:
            pass
        await asyncio.sleep(1)
    return False


TRACE_PATH = os.path.join(os.path.dirname(__file__), "last_run.json")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def write_trace(trace: dict, exit_code: int) -> None:
    trace["exit_code"] = exit_code
    trace["finished_at"] = utc_now_iso()
    try:
        with open(TRACE_PATH, "w") as fh:
            json.dump(trace, fh, indent=2, ensure_ascii=False)
        print("WROTE TRACE:", TRACE_PATH)
    except Exception as exc:
        print("WARN: failed to write trace:", exc, file=sys.stderr)


async def run() -> int:
    trace: dict = {
        "start_time": utc_now_iso(),
        "base": BASE,
        "flat": FLAT,
        "http": [],
        "ws_messages": [],
        "notes": [],
    }

    async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as client:
        ok = await wait_for_health(client, timeout=30)
        trace["http"].append({"endpoint": "/health", "ok": ok, "ts": utc_now_iso()})
        if not ok:
            print("ERROR: backend /health not ready", file=sys.stderr)
            write_trace(trace, 2)
            return 2
        print("backend healthy")

        # Fetch guard TOTP (sanity)
        try:
            r = await client.get("/api/guard/totp")
            trace["http"].append({"endpoint": "/api/guard/totp", "status": r.status_code, "text": r.text[:400], "ts": utc_now_iso()})
            print("TOTP endpoint:", r.status_code, r.text[:200])
        except Exception as exc:
            trace["notes"].append(f"guard/totp failed: {exc}")
            print("WARN: guard/totp failed:", exc)

        ws_url = f"{WS_BASE}/ws/resident/{FLAT}"
        print("Connecting websocket to", ws_url)
        events: list[dict[str, Any]] = []

        async def ws_listener(ws: websockets.WebSocketClientProtocol) -> None:
            try:
                async for msg in ws:
                    print("WS =>", msg)
                    try:
                        parsed = json.loads(msg)
                        events.append(parsed)
                        trace["ws_messages"].append({"ts": utc_now_iso(), "msg": parsed})
                    except Exception:
                        events.append({"raw": msg})
                        trace["ws_messages"].append({"ts": utc_now_iso(), "raw": msg})
            except Exception as exc:
                print("WS listener stopped:", exc)

        try:
            async with websockets.connect(ws_url) as ws:
                listener = asyncio.create_task(ws_listener(ws))

                # 1) Post a check-in
                payload = {"visitor_name": "IntegrationRunner", "visitor_type": "Delivery", "flat_number": FLAT}
                print("Posting check-in:", payload)
                r = await client.post("/api/visitors/check-in", json=payload)
                trace["http"].append({"endpoint": "/api/visitors/check-in", "status": r.status_code, "text": r.text[:400], "ts": utc_now_iso()})
                if r.status_code != 201:
                    print("ERROR: check-in failed", r.status_code, r.text, file=sys.stderr)
                    listener.cancel()
                    write_trace(trace, 3)
                    return 3
                visitor = r.json().get("visitor", {})
                visitor_id = visitor.get("id")
                print("Check-in created visitor_id:", visitor_id)

                # wait for visitor_checked_in event
                for _ in range(20):
                    if any(e.get("event") == "visitor_checked_in" for e in events):
                        break
                    await asyncio.sleep(0.5)
                else:
                    print("ERROR: did not receive visitor_checked_in event", events, file=sys.stderr)
                    listener.cancel()
                    write_trace(trace, 4)
                    return 4

                # 2) Trigger escalate via API
                print("Triggering escalate via API")
                r = await client.post("/api/escalate", json={"flat_number": FLAT, "visitor_type": "Delivery", "status": "timeout"})
                trace["http"].append({"endpoint": "/api/escalate", "status": r.status_code, "text": r.text[:400], "ts": utc_now_iso()})
                if r.status_code != 200:
                    print("ERROR: escalate API failed", r.status_code, r.text, file=sys.stderr)
                    listener.cancel()
                    write_trace(trace, 5)
                    return 5
                if not r.json().get("success", False):
                    print("ERROR: escalate API returned unsuccessful", r.text, file=sys.stderr)
                    listener.cancel()
                    write_trace(trace, 6)
                    return 6

                # wait for visitor_escalated event
                for _ in range(20):
                    if any(e.get("event") == "visitor_escalated" for e in events):
                        break
                    await asyncio.sleep(0.5)
                else:
                    print("ERROR: did not receive visitor_escalated event", events, file=sys.stderr)
                    listener.cancel()
                    write_trace(trace, 7)
                    return 7

                listener.cancel()
        except Exception as exc:
            print("ERROR: websocket/connect or run failed:", exc, file=sys.stderr)
            trace.setdefault("notes", []).append(f"websocket/connect failed: {exc}")
            write_trace(trace, 8)
            return 8

    trace.setdefault("notes", []).append("Golden-thread integration run succeeded")
    write_trace(trace, 0)
    print("Golden-thread integration run succeeded")
    return 0


if __name__ == "__main__":
    code = asyncio.run(run())
    sys.exit(code)
