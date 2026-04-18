"""
Integration test: verify Chrome Extension request format
matches the backend API expectations.

Boots the backend, sends requests in the same format as background.js,
validates responses.
"""

import subprocess
import time
import json
import sys

import httpx

API_URL = "http://localhost:8766"
API_KEY = "dev-test-key-123"
HEADERS = {"Content-Type": "application/json", "X-API-Key": API_KEY}

passed = 0
failed = 0
failures = []


def check(condition, name):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed += 1
        failures.append(name)
        print(f"  ✗ {name}")


# ── Start backend ─────────────────────────────────────────────────
print("\n═══ INTEGRATION TEST: Extension ↔ Backend ═══\n")
print("▸ Starting backend...")

proc = subprocess.Popen(
    ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8766"],
    cwd="/home/claude/linkedin-msg-backend",
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
time.sleep(2)

try:
    # ── Test 1: Health check ──────────────────────────────────────
    print("\n▸ Health check")
    resp = httpx.get(f"{API_URL}/api/health")
    check(resp.status_code == 200, "Health returns 200")
    check(resp.json()["status"] == "ok", "Status is ok")

    # ── Test 2: Auth flow (as extension would) ────────────────────
    print("\n▸ Auth flow")
    resp_no_key = httpx.get(f"{API_URL}/api/templates")
    check(resp_no_key.status_code == 401, "No key → 401")

    resp_bad_key = httpx.get(
        f"{API_URL}/api/templates",
        headers={"X-API-Key": "wrong"},
    )
    check(resp_bad_key.status_code == 403, "Bad key → 403")

    resp_ok = httpx.get(f"{API_URL}/api/templates", headers=HEADERS)
    check(resp_ok.status_code == 200, "Valid key → 200")
    templates = resp_ok.json()
    check(len(templates) >= 4, f"Got {len(templates)} templates")

    # ── Test 3: Generate message — EXACT payload format from extension
    print("\n▸ Extension payload format → Backend")

    # This is exactly what background.js sends
    extension_payload = {
        "profile": {
            "name": "Anna Kowalska",
            "headline": "Senior Data Scientist @ Samsung R&D",
            "company": "Samsung R&D Poland",
            "location": "Warszawa, woj. mazowieckie, Polska",
            "about": "Zajmuję się modelami NLP i computer vision w zespole R&D.",
            "experience": [
                "Senior Data Scientist @ Samsung R&D Poland",
                "ML Engineer @ MedVision AI",
                "Data Analyst @ Deloitte",
            ],
            "skills": ["Python", "PyTorch", "NLP", "Computer Vision"],
            "profile_url": "https://www.linkedin.com/in/anna-kowalska",
        },
        "goal": "recruitment",
        "tone": None,
        "language": "pl",
        "max_chars": 300,
        "sender_context": "Szukam ML Engineera do zespołu fintech.",
    }

    # Backend will fail at AI call (no real API key), but should validate the request format
    resp = httpx.post(
        f"{API_URL}/api/generate-message",
        headers=HEADERS,
        json=extension_payload,
        timeout=10.0,
    )

    # We expect 502 (AI call fails with fake key) — NOT 422 (validation error)
    check(
        resp.status_code != 422,
        f"Payload format accepted (no validation error, got {resp.status_code})",
    )
    if resp.status_code == 502:
        check("AI" in resp.json().get("detail", ""), "502 from AI call (expected with fake key)")
    elif resp.status_code == 200:
        data = resp.json()
        check("message" in data, "Response has 'message' field")
        check("generation_time_s" in data, "Response has 'generation_time_s' field")
        check("profile_name" in data, "Response has 'profile_name' field")

    # ── Test 4: Minimal payload (content script finds only name + headline)
    print("\n▸ Minimal extension payload")
    minimal_payload = {
        "profile": {
            "name": "Piotr Nowak",
            "headline": "Doradca Finansowy",
        },
        "goal": "networking",
        "tone": None,
        "language": "pl",
        "max_chars": 300,
        "sender_context": None,
    }

    resp = httpx.post(
        f"{API_URL}/api/generate-message",
        headers=HEADERS,
        json=minimal_payload,
        timeout=10.0,
    )
    check(resp.status_code != 422, f"Minimal payload accepted (got {resp.status_code})")

    # ── Test 5: Empty name should fail validation
    print("\n▸ Validation: empty name rejected")
    bad_payload = {
        "profile": {"name": "", "headline": "Test"},
        "goal": "networking",
    }
    resp = httpx.post(
        f"{API_URL}/api/generate-message",
        headers=HEADERS,
        json=bad_payload,
    )
    check(resp.status_code == 422, "Empty name → 422")

    # ── Test 6: All goal types accepted
    print("\n▸ All goal types accepted")
    for goal in ["recruitment", "networking", "sales", "followup"]:
        payload = {
            "profile": {"name": "Test", "headline": "Test"},
            "goal": goal,
        }
        resp = httpx.post(
            f"{API_URL}/api/generate-message",
            headers=HEADERS,
            json=payload,
            timeout=10.0,
        )
        check(resp.status_code != 422, f"Goal '{goal}' accepted")

finally:
    proc.terminate()
    proc.wait(timeout=5)
    print(f"\n═══════════════════════════════════════════════")
    print(f"  Results: {passed} passed, {failed} failed")
    if failures:
        print("\n  Failures:")
        for f in failures:
            print(f"    - {f}")
    print("═══════════════════════════════════════════════\n")
    sys.exit(1 if failed else 0)
