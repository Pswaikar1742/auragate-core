import os
import importlib

from fastapi.testclient import TestClient


def _prepare_app(to_phone: str | None = None):
    """Prepare the app with an in-memory SQLite DB and optional fallback phone.

    This sets `DATABASE_URL` before reloading the DB and app modules so the
    in-memory engine is used for tests.
    """

    os.environ["DATABASE_URL"] = "sqlite:///:memory:"
    if to_phone is None:
        os.environ.pop("TO_PHONE_NUMBER", None)
    else:
        os.environ["TO_PHONE_NUMBER"] = to_phone

    # Reload database module so it picks up the env var and recreates engine
    import backend.database as database

    importlib.reload(database)
    database.create_db_and_tables()

    import backend.main as main

    importlib.reload(main)
    return main


def test_escalate_fails_when_no_phone_configured():
    main = _prepare_app(None)
    client = TestClient(main.app)

    resp = client.post(
        "/api/escalate",
        json={"flat_number": "T4-401", "visitor_type": "Delivery", "status": "timeout"},
    )

    assert resp.status_code == 400
    assert resp.json().get("detail") == "No phone number configured for resident or fallback"


def test_escalate_success_path_with_mocked_twilio(monkeypatch):
    # Provide a fallback phone so the endpoint proceeds to trigger the IVR path.
    main = _prepare_app("+15555550123")

    async def _fake_trigger(phone, visitor):
        return "FAKE_SID"

    monkeypatch.setattr(main, "_trigger_twilio_call", _fake_trigger)

    client = TestClient(main.app)
    resp = client.post(
        "/api/escalate",
        json={"flat_number": "T4-401", "visitor_type": "Delivery", "status": "timeout"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"success": True, "message": "IVR Call Triggered to Resident"}
