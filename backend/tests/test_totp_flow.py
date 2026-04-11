import os
import sys
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def _prepare_app():
    fd, tmp_path = tempfile.mkstemp(prefix="auragate_totp_", suffix=".db")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}"

    import backend.models  # noqa: F401
    import backend.database as database
    database.create_db_and_tables()

    import backend.main as main
    return main, database.SessionLocal


def _seed_demo_residents(client: TestClient) -> None:
    response = client.post(
        "/api/resident/auth/login",
        json={"flat_number": "T4-401", "pin": "1111"},
    )
    assert response.status_code == 200


def _create_invite(client: TestClient) -> dict:
    response = client.get("/api/totp/generate", params={"guest_name": "Test Guest", "flat_number": "T4-401"})
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("visitor_id")
    assert payload.get("current_otp")
    return payload


def test_totp_verify_success_marks_visitor_approved():
    main, session_local = _prepare_app()
    client = TestClient(main.app)

    _seed_demo_residents(client)
    invite = _create_invite(client)

    verify_response = client.post(
        "/api/visitors/verify-totp",
        json={"visitor_id": invite["visitor_id"], "scanned_code": invite["current_otp"]},
    )

    assert verify_response.status_code == 200
    assert verify_response.json() == {"success": True, "status": "APPROVED"}

    import backend.models as models
    db = session_local()
    try:
        visitor = db.get(models.VisitorLog, uuid.UUID(invite["visitor_id"]))
        assert visitor is not None
        assert visitor.status == "approved"
    finally:
        db.close()


def test_totp_verify_rejects_invalid_code_for_pending_visitor():
    main, _ = _prepare_app()
    client = TestClient(main.app)

    _seed_demo_residents(client)
    invite = _create_invite(client)

    wrong_code = "000000" if invite["current_otp"] != "000000" else "111111"
    verify_response = client.post(
        "/api/visitors/verify-totp",
        json={"visitor_id": invite["visitor_id"], "scanned_code": wrong_code},
    )

    assert verify_response.status_code == 401


def test_totp_verify_is_idempotent_after_approval():
    main, _ = _prepare_app()
    client = TestClient(main.app)

    _seed_demo_residents(client)
    invite = _create_invite(client)

    first_verify = client.post(
        "/api/visitors/verify-totp",
        json={"visitor_id": invite["visitor_id"], "scanned_code": invite["current_otp"]},
    )
    assert first_verify.status_code == 200

    second_verify = client.post(
        "/api/visitors/verify-totp",
        json={"visitor_id": invite["visitor_id"], "scanned_code": "000000"},
    )
    assert second_verify.status_code == 200
    assert second_verify.json() == {"success": True, "status": "APPROVED"}


def test_totp_verify_returns_400_when_seed_missing():
    main, _ = _prepare_app()
    client = TestClient(main.app)

    _seed_demo_residents(client)

    create_response = client.post(
        "/api/visitors/check-in",
        json={
            "visitor_name": "No Seed Guest",
            "visitor_type": "Expected Guest",
            "flat_number": "T4-401",
        },
    )
    assert create_response.status_code == 201
    visitor_id = create_response.json()["visitor"]["id"]

    import backend.models as models

    with main.SessionLocal() as db:
        visitor = db.get(models.VisitorLog, uuid.UUID(visitor_id))
        assert visitor is not None
        visitor.secret_seed = None
        db.commit()

    verify_response = client.post(
        "/api/visitors/verify-totp",
        json={"visitor_id": visitor_id, "scanned_code": "123456"},
    )
    assert verify_response.status_code == 400
    assert "seed" in verify_response.json()["detail"].lower()
