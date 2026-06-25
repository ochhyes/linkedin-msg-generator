"""Dry-run test: 10 kontaktow z Connections.csv, generyczne opisy kampanii."""
import asyncio
import csv
import sys
import os

_this_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _this_dir)

# Ustaw CWD na backend/, zeby config.py zaladowal .env
os.chdir(_this_dir)

from config import settings
from services.ai_service import AiService
from services.campaign_service import CampaignService, extract_hook_category
from models import CampaignRequest, CampaignContact


async def main():
    # Wczytaj pierwsze 10 kontaktow z Connections.csv
    contacts = []
    csv_path = os.path.join(os.path.dirname(__file__), "..", "Connections.csv")
    header_found = False
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not header_found:
                if row and row[0].strip().lower().startswith("first name"):
                    header_found = True
                continue
            if len(contacts) >= 10:
                break
            if len(row) < 3 or not row[0].strip() or not row[2].strip():
                continue
            fn = row[0].strip()
            url = row[2].strip()
            company = row[4].strip() if len(row) > 4 else ""
            pos = row[5].strip() if len(row) > 5 else ""
            slug_match = url.replace("https://www.linkedin.com/in/", "").rstrip("/")
            headline = f"{company} - {pos}" if company and pos else (pos or company or "Nieznane stanowisko")
            contacts.append(
                CampaignContact(
                    contact_id=slug_match[:64],
                    first_name=fn,
                    headline=headline,
                    profile_url=url,
                )
            )

    print(f"Wczytano {len(contacts)} kontaktow z CSV.")
    print(f"AI provider: {settings.AI_PROVIDER}")
    print(f"Model: {settings.ANTHROPIC_MODEL if settings.AI_PROVIDER == 'claude' else settings.OPENAI_MODEL}")
    print()

    # GENERYCZNY opis produktu i autora (do podmiany przez uzytkownika)
    product_desc = (
        "OPIS_PRODUKTU - do wypelnienia przez uzytkownika."
    )
    author_ctx = (
        "KONTEKST_AUTORA - do wypelnienia przez uzytkownika."
    )

    ai = AiService()
    svc = CampaignService(ai=ai)

    req = CampaignRequest(
        batch_id="dry-run-10",
        contacts=contacts,
        product_description=product_desc,
        author_context=author_ctx,
    )

    print("Generuje wiadomosci...\n")
    resp = await svc.generate_campaign(req)

    for i, msg in enumerate(resp.messages):
        contact = contacts[i]
        hook = extract_hook_category(contact.headline or "")
        status_icon = "[OK]" if msg.status == "ok" else "[BLAD]"
        print(f"--- Kontakt {i+1}: {contact.first_name} | {hook} | {contact.headline} {status_icon}")
        if msg.status == "ok":
            print(f"    {msg.message}")
        else:
            print(f"    Blad: {msg.error[:120] if msg.error else 'nieznany'}")
        print()

    ok = sum(1 for m in resp.messages if m.status == "ok")
    err = sum(1 for m in resp.messages if m.status == "error")
    print(f"OK: {ok}, Bledy: {err}")


if __name__ == "__main__":
    asyncio.run(main())