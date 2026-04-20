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


# ── Personalization (few-shot, sender style, custom overrides) ────────

class TestPersonalization:
    """Few-shot examples, sender style sample, custom antipatterns & system prompt."""

    def _base_req(self, **overrides):
        from models import GenerateMessageRequest, LinkedInProfile
        payload = {
            "profile": LinkedInProfile(**PROFILE_FULL_PL),
            "goal": "recruitment",
            "language": "pl",
        }
        payload.update(overrides)
        return GenerateMessageRequest(**payload)

    def test_build_prompt_uses_default_examples_when_no_custom(self):
        """No custom_examples provided -> default OVB/IT examples should appear."""
        from services.ai_service import build_prompt, GOAL_PROMPTS

        req = self._base_req()
        prompt = build_prompt(req)
        default_good = GOAL_PROMPTS["recruitment"]["examples_good"]
        # At least a distinctive fragment of each default good example should be in prompt
        assert default_good[0]["message"][:30] in prompt
        assert default_good[1]["message"][:30] in prompt
        assert "PRZYKŁADY DOBRE" in prompt
        assert "PRZYKŁAD ZŁY" in prompt

    def test_build_prompt_overrides_examples_with_custom(self):
        """custom_examples for a goal -> defaults for that goal are replaced."""
        from services.ai_service import build_prompt, GOAL_PROMPTS

        req = self._base_req(custom_examples={
            "recruitment": {
                "examples_good": [{
                    "profile": "Unikalny profil CUSTOM_PROFILE_MARKER",
                    "message": "Unikalna wiadomość CUSTOM_MESSAGE_MARKER",
                }],
                "example_bad": {
                    "message": "Zła wiadomość CUSTOM_BAD_MARKER",
                    "why": "Powód CUSTOM_WHY_MARKER",
                },
            }
        })
        prompt = build_prompt(req)
        assert "CUSTOM_PROFILE_MARKER" in prompt
        assert "CUSTOM_MESSAGE_MARKER" in prompt
        assert "CUSTOM_BAD_MARKER" in prompt
        assert "CUSTOM_WHY_MARKER" in prompt
        # Default recruitment example messages should NOT appear
        default_first_msg = GOAL_PROMPTS["recruitment"]["examples_good"][0]["message"][:40]
        assert default_first_msg not in prompt

    def test_build_prompt_includes_sender_style_sample_when_provided(self):
        from services.ai_service import build_prompt

        style = "Hej, lecę krótko. Bez ściemy. Mam jedno pytanie i znikam."
        req = self._base_req(sender_style_sample=style)
        prompt = build_prompt(req)
        assert "PRÓBKA STYLU NADAWCY" in prompt
        assert style in prompt

    def test_build_prompt_skips_sender_style_block_when_missing(self):
        from services.ai_service import build_prompt

        req = self._base_req()  # no sender_style_sample
        prompt = build_prompt(req)
        assert "PRÓBKA STYLU NADAWCY" not in prompt

    def test_custom_antipatterns_appended_not_replaced(self):
        """custom_antipatterns -> default patterns must still be present."""
        from services.ai_service import build_prompt, DEFAULT_ANTIPATTERNS

        req = self._base_req(custom_antipatterns=[
            "Nie używaj słowa 'synergy'",
            "Zakaz słowa 'disruption'",
        ])
        prompt = build_prompt(req)
        # Custom ones present
        assert "synergy" in prompt
        assert "disruption" in prompt
        # A distinctive fragment from default antipatterns still present
        assert "Twoje doświadczenie jest imponujące" in prompt
        assert DEFAULT_ANTIPATTERNS[0] in prompt

    def test_system_prompt_override_passed_to_api_call(self):
        """custom_system_prompt must be forwarded to call_claude via generate_message."""
        import asyncio
        from unittest.mock import AsyncMock, patch
        from services.ai_service import generate_message

        req = self._base_req(custom_system_prompt="Jesteś poetą-copywriterem XYZ_MARKER")

        with patch("services.ai_service.call_claude", new_callable=AsyncMock) as mock:
            mock.return_value = "Fake message"
            asyncio.get_event_loop().run_until_complete(generate_message(req)) \
                if False else asyncio.run(generate_message(req))
            # First positional arg is prompt, system_prompt is kwarg
            _, kwargs = mock.call_args
            assert kwargs.get("system_prompt") == "Jesteś poetą-copywriterem XYZ_MARKER"

    def test_request_validation_rejects_oversized_sender_sample(self):
        """sender_style_sample > 1000 chars -> 422."""
        too_long = "x" * 1500
        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_PL,
                "goal": "recruitment",
                "sender_style_sample": too_long,
            },
        )
        assert resp.status_code == 422

    def test_recruitment_prompt_includes_sender_offer_verbatim(self):
        """Regression: sender_offer must appear verbatim in prompt with TWOJA OFERTA header."""
        from services.ai_service import build_prompt

        offer = "OVB, rekrutacja doradców finansowych w Krakowie, model prowizyjny"
        req = self._base_req(goal="recruitment", sender_offer=offer)
        prompt = build_prompt(req)
        assert "TWOJA OFERTA" in prompt
        assert offer in prompt

    def test_bridge_rule_active_in_system_prompt(self):
        """System prompt must carry the bridge-not-mirror rule (rule #6)."""
        from services.ai_service import DEFAULT_SYSTEM_PROMPT
        assert "MOST" in DEFAULT_SYSTEM_PROMPT
        assert "LUSTRO" in DEFAULT_SYSTEM_PROMPT
        assert "TWOJA OFERTA" in DEFAULT_SYSTEM_PROMPT

    def test_prompt_skips_offer_block_when_missing(self):
        """Without sender_offer the dedicated block must not appear in prompt.

        Note: 'TWOJA OFERTA' alone shows up in the anti-pattern text (references
        the block by name), so we check for the block-specific marker instead.
        """
        from services.ai_service import build_prompt

        req = self._base_req()  # no sender_offer
        prompt = build_prompt(req)
        assert "to proponujesz odbiorcy" not in prompt

    def test_request_validation_rejects_unknown_goal_in_custom_examples(self):
        """custom_examples with unknown goal key -> 422."""
        resp = client.post(
            "/api/generate-message",
            headers=HEADERS,
            json={
                "profile": PROFILE_FULL_PL,
                "goal": "recruitment",
                "custom_examples": {
                    "xxx_not_a_goal": {
                        "examples_good": [{"profile": "a", "message": "b"}],
                    }
                },
            },
        )
        assert resp.status_code == 422
        assert "Nieznane" in resp.json()["detail"][0]["msg"] or \
               "xxx_not_a_goal" in str(resp.json())


class TestRegisterAndRegressions:
    """Rejestr językowy Pan/Pani, brak wołacza, długości CTA, ban halucynacji."""

    def _base_req(self, **overrides):
        from models import GenerateMessageRequest, LinkedInProfile
        payload = {
            "profile": LinkedInProfile(**PROFILE_FULL_PL),
            "goal": "recruitment",
            "language": "pl",
        }
        payload.update(overrides)
        return GenerateMessageRequest(**payload)

    def test_system_prompt_enforces_pan_pani_register(self):
        from services.ai_service import DEFAULT_SYSTEM_PROMPT
        assert "Pan/Pani" in DEFAULT_SYSTEM_PROMPT
        assert "REJESTR JĘZYKOWY" in DEFAULT_SYSTEM_PROMPT
        assert "zabroniona" in DEFAULT_SYSTEM_PROMPT

    def test_system_prompt_bans_vocative_openings(self):
        from services.ai_service import DEFAULT_SYSTEM_PROMPT
        # Must explicitly ban vocative name openings
        assert "BEZ wołacza" in DEFAULT_SYSTEM_PROMPT
        assert "Panie Rafale" in DEFAULT_SYSTEM_PROMPT  # example of what NOT to do

    def test_system_prompt_sets_cta_lengths(self):
        from services.ai_service import DEFAULT_SYSTEM_PROMPT
        assert "DŁUGOŚĆ SPOTKANIA" in DEFAULT_SYSTEM_PROMPT
        assert "30 minut" in DEFAULT_SYSTEM_PROMPT
        assert "15-20" in DEFAULT_SYSTEM_PROMPT

    def test_system_prompt_bans_hallucinated_mutual_connections(self):
        from services.ai_service import DEFAULT_SYSTEM_PROMPT
        assert "HALUCYNACJI" in DEFAULT_SYSTEM_PROMPT
        assert "wspólnych znajomych" in DEFAULT_SYSTEM_PROMPT or \
               "wspólnych kontaktów" in DEFAULT_SYSTEM_PROMPT

    def test_antipatterns_contain_no_vocative_and_no_ty(self):
        from services.ai_service import DEFAULT_ANTIPATTERNS
        joined = "\n".join(DEFAULT_ANTIPATTERNS)
        # Anti-pattern about informal "ty"
        assert 'Forma "ty"' in joined or "forma 'ty'" in joined.lower()
        # Anti-pattern about vocative name
        assert "Wołanie po imieniu" in joined or "wołaniu" in joined.lower()
        # Anti-pattern about fake mutual connections
        assert "Halucynowanie" in joined
        # Anti-pattern about geographic shorthand
        assert "trójmiejskim" in joined or "Trójmieście" in joined

    def test_antipatterns_merged_open_to_phrase_not_duplicated(self):
        """Old 'Czy byłbyś otwarty' and new 'Czy jesteś otwarty' should be ONE merged entry."""
        from services.ai_service import DEFAULT_ANTIPATTERNS
        otwarty_entries = [p for p in DEFAULT_ANTIPATTERNS if "otwarty" in p.lower()]
        assert len(otwarty_entries) == 1, \
            f"Expected exactly 1 antipattern about 'otwarty', got {len(otwarty_entries)}"

    def test_mutual_connections_warning_when_missing(self):
        from services.ai_service import build_prompt
        from models import GenerateMessageRequest, LinkedInProfile
        profile = LinkedInProfile(name="Jan Kowalski", headline="CEO")  # no mutual_connections
        req = GenerateMessageRequest(profile=profile, goal="recruitment")
        prompt = build_prompt(req)
        assert "Wspólne kontakty: BRAK" in prompt
        assert "NIE WOLNO" in prompt

    def test_mutual_connections_value_when_present(self):
        from services.ai_service import build_prompt
        from models import GenerateMessageRequest, LinkedInProfile
        profile = LinkedInProfile(
            name="Jan Kowalski",
            headline="CEO",
            mutual_connections="5 wspólnych kontaktów",
        )
        req = GenerateMessageRequest(profile=profile, goal="recruitment")
        prompt = build_prompt(req)
        assert "5 wspólnych kontaktów" in prompt
        # No warning when value is present
        assert "NIE WOLNO wspominać" not in prompt

    def test_default_recruitment_examples_use_pan_pani_and_30min(self):
        """Default recruitment good examples must follow new register rules."""
        from services.ai_service import GOAL_PROMPTS
        for ex in GOAL_PROMPTS["recruitment"]["examples_good"]:
            msg = ex["message"]
            # Must mention 30 minutes
            assert "30 minut" in msg, f"Missing '30 minut' in: {msg[:80]}..."
            # Must use Pan/Pani form somewhere
            assert ("Pan" in msg or "Pani" in msg), \
                f"No Pan/Pani form in: {msg[:80]}..."
            # Must NOT open with name in nominative or vocative
            first_word = msg.split(",")[0].strip().split()[0]
            assert first_word not in [
                "Cześć", "Hej", "Witam", "Rafał", "Anna", "Kasia", "Adam",
            ], f"Bad opening word '{first_word}' in: {msg[:80]}..."


class TestSettingsDefaultsEndpoint:
    def test_requires_auth(self):
        resp = client.get("/api/settings/defaults")
        assert resp.status_code == 401

    def test_returns_goal_prompts_structure(self):
        resp = client.get("/api/settings/defaults", headers=HEADERS)
        assert resp.status_code == 200
        data = resp.json()

        assert "goal_prompts" in data
        assert "default_antipatterns" in data
        assert "default_system_prompt" in data
        assert "tone_defaults" in data

        # All 4 goals present
        for goal in ["recruitment", "networking", "sales", "followup"]:
            assert goal in data["goal_prompts"]
            gp = data["goal_prompts"][goal]
            assert "do" in gp
            assert "nie_rob" in gp
            assert "examples_good" in gp
            assert len(gp["examples_good"]) >= 1
            assert "example_bad" in gp
            assert "message" in gp["example_bad"]
            assert "why" in gp["example_bad"]

        # Sanity on defaults
        assert len(data["default_antipatterns"]) >= 5
        assert isinstance(data["default_system_prompt"], str)
        assert len(data["default_system_prompt"]) > 50
