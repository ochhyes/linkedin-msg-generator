"""Tests for LinkedIn Message Generator Backend."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

# Patch settings before importing app
import os
os.environ["API_KEYS"] = "test-key-123,second-key-456"
os.environ["AI_PROVIDER"] = "claude"
os.environ["ANTHROPIC_API_KEY"] = "fake-key-for-tests"

from main import app

client = TestClient(app)

HEADERS = {"X-API-Key": "test-key-123"}
HEADERS_BAD = {"X-API-Key": "wrong-key"}


# ── Sample profiles ──────────────────────────────────────────────────

PROFILE_FULL_PL = {
    "name": "Anna Kowalska",
    "headline": "Senior Data Scientist @ Samsung R&D",
    "company": "Samsung R&D Poland",
    "location": "Warszawa, Polska",
    "about": "Zajmuję się modelami NLP i computer vision w zespole R&D. "
             "Wcześniej pracowałam w startupie medtechowym, gdzie budowaliśmy "
             "system wykrywania zmian nowotworowych na zdjęciach RTG. "
             "Pasjonatka open source i mentorka w programie Women in Tech.",
    "experience": [
        "Senior Data Scientist @ Samsung R&D Poland (2022-obecnie)",
        "ML Engineer @ MedVision AI (2019-2022)",
        "Data Analyst @ Deloitte (2017-2019)",
    ],
    "skills": ["Python", "PyTorch", "NLP", "Computer Vision", "MLOps", "SQL"],
    "profile_url": "https://linkedin.com/in/anna-kowalska",
}

PROFILE_FULL_EN = {
    "name": "James Mitchell",
    "headline": "VP of Engineering @ Stripe",
    "company": "Stripe",
    "location": "San Francisco, CA",
    "about": "Leading infrastructure and platform teams at Stripe. "
             "Previously built and scaled the payments platform at Square. "
             "Passionate about developer experience and API design.",
    "experience": [
        "VP of Engineering @ Stripe (2021-present)",
        "Senior Director of Engineering @ Square (2018-2021)",
        "Engineering Manager @ Google (2014-2018)",
    ],
    "skills": ["Engineering Leadership", "API Design", "Distributed Systems", "Payments"],
    "profile_url": "https://linkedin.com/in/james-mitchell",
}

PROFILE_MINIMAL = {
    "name": "Piotr Nowak",
    "headline": "Doradca Finansowy",
}

PROFILE_MISSING_NAME = {
    "name": "",
    "headline": "Software Engineer",
}

MOCK_AI_RESPONSE_PL = (
    "Widzę, że pracujesz nad modelami NLP w Samsung R&D — "
    "Twoje doświadczenie z MedVision AI w wykrywaniu zmian na RTG robi wrażenie. "
    "Szukamy kogoś z takim backgroundem do naszego zespołu ML. "
    "Masz chwilę na krótką rozmowę w tym tygodniu?"
)

MOCK_AI_RESPONSE_EN = (
    "Your transition from Square's payments platform to leading infrastructure at Stripe "
    "is a fascinating trajectory. I'd love to pick your brain on API design patterns "
    "for financial services. Coffee chat next week?"
)


# ── Health ────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_ok(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["ai_provider"] == "claude"
        assert "version" in data


# ── Auth ──────────────────────────────────────────────────────────────

class TestAuth:
    def test_no_api_key(self):
        resp = client.get("/api/templates")
        assert resp.status_code == 401
        assert "Brak klucza API" in resp.json()["detail"]

    def test_invalid_api_key(self):
        resp = client.get("/api/templates", headers=HEADERS_BAD)
        assert resp.status_code == 403
        assert "Nieprawidłowy" in resp.json()["detail"]

    def test_valid_api_key(self):
        resp = client.get("/api/templates", headers=HEADERS)
        assert resp.status_code == 200

    def test_second_valid_key(self):
        resp = client.get("/api/templates", headers={"X-API-Key": "second-key-456"})
        assert resp.status_code == 200


# ── Templates ─────────────────────────────────────────────────────────

class TestTemplates:
    def test_returns_templates(self):
        resp = client.get("/api/templates", headers=HEADERS)
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 4
        ids = [t["id"] for t in data]
        assert "recruitment" in ids
        assert "networking" in ids
        assert "sales" in ids


# ── Generate Message ──────────────────────────────────────────────────

class TestGenerateMessage:
    @patch("main.generate_message", new_callable=AsyncMock)
    def test_full_profile_pl_recruitment(self, mock_gen):
        """Full Polish profile, recruitment goal."""
        mock_gen.return_value = MOCK_AI_RESPONSE_PL

        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_PL,
                "goal": "recruitment",
                "language": "pl",
                "max_chars": 1000,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == MOCK_AI_RESPONSE_PL
        assert data["profile_name"] == "Anna Kowalska"
        assert data["goal"] == "recruitment"
        assert "generation_time_s" in data

    @patch("main.generate_message", new_callable=AsyncMock)
    def test_full_profile_en_networking(self, mock_gen):
        """Full English profile, networking goal."""
        mock_gen.return_value = MOCK_AI_RESPONSE_EN

        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_EN,
                "goal": "networking",
                "language": "en",
                "max_chars": 1000,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == MOCK_AI_RESPONSE_EN
        assert data["profile_name"] == "James Mitchell"

    @patch("main.generate_message", new_callable=AsyncMock)
    def test_minimal_profile(self, mock_gen):
        """Minimal profile — only name + headline."""
        mock_gen.return_value = "Cześć Piotr, widzę że działasz w doradztwie finansowym."

        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_MINIMAL,
                "goal": "networking",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["profile_name"] == "Piotr Nowak"

    def test_missing_name_rejected(self):
        """Empty name should be rejected."""
        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_MISSING_NAME,
                "goal": "recruitment",
            },
        )
        assert resp.status_code == 422
        assert "imię" in resp.json()["detail"].lower() or "name" in resp.json()["detail"].lower()

    def test_no_auth_rejected(self):
        resp = client.post(
            "/api/generate-message",
            json={"profile": PROFILE_FULL_PL, "goal": "networking"},
        )
        assert resp.status_code == 401

    @patch("main.generate_message", new_callable=AsyncMock)
    def test_with_sender_context(self, mock_gen):
        """Request with sender_context included."""
        mock_gen.return_value = "Wiadomość z kontekstem nadawcy."

        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_PL,
                "goal": "recruitment",
                "sender_context": "Jestem Regionalnym Dyrektorem w firmie OVB. Szukam analityków danych do zespołu.",
            },
        )
        assert resp.status_code == 200

    @patch("main.generate_message", new_callable=AsyncMock)
    def test_custom_tone(self, mock_gen):
        """Custom tone override."""
        mock_gen.return_value = "Hej, super profil!"

        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_PL,
                "goal": "networking",
                "tone": "bardzo luźny, jakby do kumpla",
                "max_chars": 150,
            },
        )
        assert resp.status_code == 200

    @patch("main.generate_message", new_callable=AsyncMock)
    def test_ai_error_returns_502(self, mock_gen):
        """AI service failure should return 502."""
        mock_gen.side_effect = Exception("AI API timeout")

        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_PL,
                "goal": "networking",
            },
        )
        assert resp.status_code == 502
        assert "AI" in resp.json()["detail"]

    def test_invalid_json(self):
        """Malformed request body."""
        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            content="not json",
        )
        assert resp.status_code == 422


# ── Rate Limiter ──────────────────────────────────────────────────────

class TestRateLimiter:
    def test_rate_limiter_logic(self):
        from services.rate_limiter import RateLimiter

        limiter = RateLimiter(max_requests=3, window_seconds=1)
        assert limiter.allow("test") is True
        assert limiter.allow("test") is True
        assert limiter.allow("test") is True
        assert limiter.allow("test") is False  # 4th blocked

        # Different client not affected
        assert limiter.allow("other") is True


# ── Prompt Builder ────────────────────────────────────────────────────

class TestPromptBuilder:
    def test_build_prompt_full(self):
        from models import GenerateMessageRequest, LinkedInProfile
        from services.ai_service import build_prompt

        req = GenerateMessageRequest(
            profile=LinkedInProfile(**PROFILE_FULL_PL),
            goal="recruitment",
            language="pl",
            max_chars=1000,
        )
        prompt = build_prompt(req)
        assert "Anna Kowalska" in prompt
        assert "Samsung" in prompt
        assert "NLP" in prompt
        assert "3-5 zdań" in prompt
        assert "recruitment" in prompt or "rekrutacyj" in prompt or "CO PISAĆ" in prompt

    def test_build_prompt_minimal(self):
        from models import GenerateMessageRequest, LinkedInProfile
        from services.ai_service import build_prompt

        req = GenerateMessageRequest(
            profile=LinkedInProfile(**PROFILE_MINIMAL),
            goal="networking",
        )
        prompt = build_prompt(req)
        assert "Piotr Nowak" in prompt
        assert "Doradca Finansowy" in prompt
        # No "O mnie" section since it's empty
        assert "O mnie:" not in prompt
