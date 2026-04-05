import os
import importlib
import sys
from pathlib import Path

# Ensure project root is on sys.path so `import backend.*` works when pytest
# executes from the tests folder.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient


def _prepare_app(to_phone: str | None = None):
    """Prepare the app with a SQLite file DB and optional fallback phone.

    Using a file-backed SQLite DB avoids SQLite "same thread" and
    in-memory connection isolation when running the TestClient in a
    multi-threaded test harness.
    """

    # Create a unique temp DB file (avoids stale/readonly file collisions in CI).
    import tempfile

    fd, tmp_path = tempfile.mkstemp(prefix="auragate_test_", suffix=".db")
    os.close(fd)
    db_path = tmp_path
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

    if to_phone is None:
        os.environ.pop("TO_PHONE_NUMBER", None)
    else:
        os.environ["TO_PHONE_NUMBER"] = to_phone

    import backend.models as models
    import backend.database as database
    database.create_db_and_tables()

    import backend.main as main
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
    # Force the test adapter to noop so no network calls are attempted.
    os.environ["IVR_ADAPTER"] = "noop"
    main = _prepare_app("+15555550123")

    client = TestClient(main.app)
    resp = client.post(
        "/api/escalate",
        json={"flat_number": "T4-401", "visitor_type": "Delivery", "status": "timeout"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"success": True, "message": "IVR Call Triggered to Resident"}
