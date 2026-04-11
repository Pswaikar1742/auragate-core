import os
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def _prepare_app():
    fd, tmp_path = tempfile.mkstemp(prefix="auragate_risk_", suffix=".db")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}"

    import backend.models  # noqa: F401
    import backend.database as database

    database.create_db_and_tables()

    import backend.main as main

    return main


def _seed_demo_residents(client: TestClient) -> None:
    response = client.post(
        "/api/resident/auth/login",
        json={"flat_number": "T4-401", "pin": "1111"},
    )
    assert response.status_code == 200


def test_unknown_self_serve_marks_identity_collision_high_risk():
    main = _prepare_app()
    client = TestClient(main.app)

    _seed_demo_residents(client)

    first = client.post(
        "/api/visitors/check-in",
        json={
            "visitor_name": "Alias One",
            "visitor_type": "Visitor Self-Serve",
            "flat_number": "T4-401",
            "phone_number": "+919999000111",
            "image_payload": "data:image/jpeg;base64,AAA",
        },
    )
    assert first.status_code == 201
    assert first.json()["visitor"]["status"] == "pending"

    second = client.post(
        "/api/visitors/check-in",
        json={
            "visitor_name": "Alias Two",
            "visitor_type": "Visitor Self-Serve",
            "flat_number": "T4-401",
            "phone_number": "+919999000111",
            "image_payload": "data:image/jpeg;base64,BBB",
        },
    )
    assert second.status_code == 201
    assert second.json()["visitor"]["status"] == "high_risk_identity"


def test_unknown_self_serve_marks_scout_after_three_distinct_flats():
    main = _prepare_app()
    client = TestClient(main.app)

    _seed_demo_residents(client)

    payloads = [
        {
            "visitor_name": "Scout User",
            "visitor_type": "Visitor Self-Serve",
            "flat_number": "T4-401",
            "phone_number": "+919999000222",
        },
        {
            "visitor_name": "Scout User",
            "visitor_type": "Visitor Self-Serve",
            "flat_number": "T4-402",
            "phone_number": "+919999000222",
        },
        {
            "visitor_name": "Scout User",
            "visitor_type": "Visitor Self-Serve",
            "flat_number": "T4-503",
            "phone_number": "+919999000222",
        },
    ]

    statuses = []
    for payload in payloads:
        response = client.post(
            "/api/visitors/check-in",
            json={
                **payload,
                "image_payload": "data:image/jpeg;base64,CCC",
            },
        )
        assert response.status_code == 201
        statuses.append(response.json()["visitor"]["status"])

    assert statuses[0] == "pending"
    assert statuses[1] == "pending"
    assert statuses[2] == "high_risk_scout"
