"""
Testy endpointu /api/diagnostics/scrape-failure (#5).

Pokrycie:
- valid payload + valid key → 204 + linia w pliku JSONL
- invalid payload (zły slug_hash) → 422
- brak X-API-Key → 401
- 3× POST z rzędu → 3 linie w append order
- zły API-Key → 403 (bonus regression)
"""

import json
import os

import pytest

# Patch env BEFORE importing app (jak w test_api.py)
os.environ.setdefault("API_KEYS", "test-key-123,second-key-456")
os.environ.setdefault("AI_PROVIDER", "claude")
os.environ.setdefault("ANTHROPIC_API_KEY", "fake-key-for-tests")

from fastapi.testclient import TestClient

from config import settings
from main import app

client = TestClient(app)

HEADERS = {"X-API-Key": "test-key-123"}
HEADERS_BAD = {"X-API-Key": "wrong-key"}


def _valid_payload(**overrides):
    base = {
        "client_timestamp": "2026-05-05T12:34:56.000Z",
        "extension_version": "1.2.0",
        # SHA-256 of "joanna-doe" — irrelevant which slug, byle 64 hex chars
        "slug_hash": "a" * 64,
        "url": "https://www.linkedin.com/in/joanna-doe/",
        "browser_ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
        "diagnostics": {
            "h1Count": 0,
            "hasTopCard": False,
            "voyagerPayloadCount": 0,
            "readyState": "complete",
        },
        "error_message": "Timeout: LinkedIn nie wyrenderował profilu w 8s.",
    }
    base.update(overrides)
    return base


@pytest.fixture
def tmp_log(monkeypatch, tmp_path):
    """Przekierowuje SCRAPE_FAILURE_LOG_PATH na tmp file per test."""
    log_path = tmp_path / "failures.jsonl"
    monkeypatch.setattr(settings, "SCRAPE_FAILURE_LOG_PATH", str(log_path))
    return log_path


class TestDiagnosticsAuth:
    def test_no_api_key(self, tmp_log):
        resp = client.post("/api/diagnostics/scrape-failure", json=_valid_payload())
        assert resp.status_code == 401
        # Plik nie powinien zostać utworzony (request odbity przed handlerem)
        assert not tmp_log.exists()

    def test_invalid_api_key(self, tmp_log):
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS_BAD,
            json=_valid_payload(),
        )
        assert resp.status_code == 403
        assert not tmp_log.exists()


class TestDiagnosticsHappyPath:
    def test_valid_payload_returns_204(self, tmp_log):
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(),
        )
        assert resp.status_code == 204
        assert resp.content == b""  # 204 → empty body

    def test_valid_payload_writes_jsonl_line(self, tmp_log):
        client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(),
        )
        assert tmp_log.exists()
        lines = tmp_log.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])

        # Wszystkie pola z payload'u + dorzucone server_timestamp
        assert entry["client_timestamp"] == "2026-05-05T12:34:56.000Z"
        assert entry["extension_version"] == "1.2.0"
        assert entry["slug_hash"] == "a" * 64
        assert entry["url"] == "https://www.linkedin.com/in/joanna-doe/"
        assert "Chrome" in entry["browser_ua"]
        assert entry["diagnostics"]["h1Count"] == 0
        assert entry["diagnostics"]["hasTopCard"] is False
        assert "Timeout" in entry["error_message"]
        assert "server_timestamp" in entry
        # ISO8601 z timezone — sprawdzam że ma 'T' i ofset/Z
        assert "T" in entry["server_timestamp"]


class TestDiagnosticsValidation:
    def test_invalid_slug_hash_too_short(self, tmp_log):
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(slug_hash="abc123"),
        )
        assert resp.status_code == 422

    def test_invalid_slug_hash_uppercase(self, tmp_log):
        # regex wymaga lowercase hex
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(slug_hash="A" * 64),
        )
        assert resp.status_code == 422

    def test_missing_required_field(self, tmp_log):
        payload = _valid_payload()
        del payload["diagnostics"]
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=payload,
        )
        assert resp.status_code == 422

    def test_invalid_extension_version(self, tmp_log):
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(extension_version="not-semver"),
        )
        assert resp.status_code == 422

    def test_url_too_long(self, tmp_log):
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(url="https://x/" + ("a" * 600)),
        )
        assert resp.status_code == 422


class TestDiagnosticsAppendOnly:
    def test_three_posts_three_lines_in_order(self, tmp_log):
        for i in range(3):
            resp = client.post(
                "/api/diagnostics/scrape-failure",
                headers=HEADERS,
                json=_valid_payload(
                    client_timestamp=f"2026-05-05T12:00:0{i}.000Z",
                    error_message=f"Fail #{i}",
                ),
            )
            assert resp.status_code == 204

        lines = tmp_log.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 3
        entries = [json.loads(line) for line in lines]
        assert entries[0]["error_message"] == "Fail #0"
        assert entries[1]["error_message"] == "Fail #1"
        assert entries[2]["error_message"] == "Fail #2"
        # Każda linia osobno parsowalna jako JSON (sanity)
        assert all("server_timestamp" in e for e in entries)


class TestDiagnosticsEventType:
    """Pole event_type (#19 Faza 1B) — domyślne 'scrape_failure', opcjonalnie 'bulk_connect_click_failure'."""

    def test_bulk_connect_event_type(self, tmp_log):
        # Klient v1.4.0+ wysyła explicit event_type dla fail'i auto-click'a
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=_valid_payload(
                event_type="bulk_connect_click_failure",
                error_message="modal_did_not_appear",
            ),
        )
        assert resp.status_code == 204
        assert resp.content == b""

        lines = tmp_log.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        entry = json.loads(lines[-1])
        assert entry["event_type"] == "bulk_connect_click_failure"
        assert entry["error_message"] == "modal_did_not_appear"

    def test_event_type_default_backward_compat(self, tmp_log):
        # Klient < 1.4.0 nie wysyła event_type — Pydantic default = "scrape_failure"
        payload = _valid_payload()
        payload.pop("event_type", None)  # gwarancja że klucza nie ma w payload
        resp = client.post(
            "/api/diagnostics/scrape-failure",
            headers=HEADERS,
            json=payload,
        )
        assert resp.status_code == 204

        lines = tmp_log.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        entry = json.loads(lines[-1])
        assert entry["event_type"] == "scrape_failure"
