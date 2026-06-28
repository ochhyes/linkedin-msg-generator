# Sprint: Niezawodna wysyłka wiadomości — wersja agentic-loop-DoD

> Rama: kampania to **długo działająca automatyzacja w tle** z efektem **nieodwracalnym** (wysłany DM), **LLM w pętli** (generacja treści), **ryzykiem runaway** (setki kontaktów) i **siecią/detekcją** (LinkedIn). To kwalifikuje cały sprint pod dyscyplinę agentic-loop-DoD.
> Audyt: 2026-06-28. Faza: PM (obraz sprintu). STOP przed kodowaniem — czeka 1 akcja diagnostyczna (T0).

---

## 0. Zasada nadrzędna (skill): „Skąd pętla wie, że skończyła DOBRZE?"

Definiujemy DoD jako **obserwowalny stan**, weryfikowany **osobno** od generacji, **deterministycznie** gdzie się da. AI zwęża się do JEDNEGO zadania: napisać prozę nad zweryfikowaną paczką faktów. Wszystko inne (dane, dostawa, bezpieczeństwo konta, anty-halucynacja) = algorytm.

To NIE jest agent — to **dwa workflowy o stałej ścieżce**:

| Pętla | Efekt uboczny | Ryzyko | Wzorzec |
|---|---|---|---|
| **Enrichment** (scrape → profileDb) | łagodny (read + zapis lokalny) | detekcja, sieć | workflow, stała ścieżka |
| **Wysyłka** (compose → send) | **NIEODWRACALNY** (DM) | detekcja, podwójna wysyłka, runaway | workflow + **HITL** |

---

## 1. Diagnoza potwierdzona (root cause „nie wysyła")

- `messaging/thread/new/?recipients=<slug>` **NIE ustawia odbiorcy** — composer otwiera się pusty, brak „pigułki" w „Do:", przycisk Wyślij trwale wyszarzony, tekst nigdzie się nie wpisuje. (Potwierdzone obserwacją Marcina 2026-06-28.)
- Thread URN jest **nieprzezroczysty** i niewyprowadzalny ze sluga: `…/thread/2-ZDdkMzRiNWUtZmQxZi00NDI0LTk5YTctNzk3N2E1ZWNjMDYzXzEwMA==/`. Bez member-URN `thread/new` jest martwy.
- **Decyzja: Podejście 1 — profil → „Wyślij wiadomość".** Odbiorca rozwiązany jednoznacznie (jesteśmy na jego profilu). Najludziejsza ścieżka.
- Edge case: slugi z polskimi znakami (`/in/jowita-ż-5b800a150/`) — encoding sluga musi przejść `encodeURIComponent` przy nawigacji (spójnie z regułą `extractSlugFromUrl`).

---

## 1b. T0 — wyniki dumpu na żywo (2026-06-28, Claude in Chrome, konto Marcina)

Wysyłka nigdy nie działała bo jest zepsuta na **CZTERECH niezależnych osiach**:

**(1) Zły parametr URL.** Kod: `thread/new/?recipients=<slug>` (l.mn. + vanity slug). Poprawnie: `thread/new/?recipient=<memberURN>&screenContext=NON_SELF_PROFILE_VIEW` (l.**poj.** + obfuskowany member-ID `ACoAA…`). Z slugiem odbiorca się NIE ustawia → composer pusty. Z URN — ustawia się („Jola Rybicka" pojawiła się jako odbiorca). ✅ potwierdzone.

**(2) Member-URN trzeba zdobyć.** Przycisk „Message" na profilu to `<a href="/messaging/compose/…?recipient=ACoAA…">`. Content script na `/in/<slug>/` może odczytać ten href i wyłuskać URN, ALBO programatycznie kliknąć przycisk i pozwolić LinkedInowi zbudować URL. Przycisk: `<a>`, tekst „Message <Imię>" (EN) / „Wyślij wiadomość" (PL), pathname `/messaging/compose/`, **hashowane klasy** (`_489dd918…`) + **dynamiczny `componentkey` UUID** → BRAK stabilnego selektora po klasie/id; lokalizuj po `href*="/messaging/compose"` lub tekście. Przycisk **NAWIGUJE** (nie otwiera overlay).

**(3) Modale-interstitiale zasłaniają composer.** Modal Premium („Dzięki Premium wyślesz do każdego") + baner cookie nakładają się na formularz. Flow MUSI je wykryć i zamknąć. X modala ma hashowaną klasę bez aria-label → zamykać klikiem we współrzędne / klawiszem Escape, nie po selektorze.

**(4) Brama 1° (krytyczny DoD).** Darmowy composer renderuje się **wyłącznie dla kontaktów 1. stopnia.** Dla nie-kontaktu (Jola) → ściana Premium/InMail, **ZERO composera** (potwierdzone: 0 pól edytowalnych nawet po przebiciu shadow DOM). Kampanie celują w Connections.csv (1°), więc w produkcji OK — ale DoD musi bramkować: tylko 1°, inaczej skip / connect-first.

**KOREKTA (fixture `messaging_composer_sdui.html`, dump Marcina z realnego wątku 1°):** composer messagingu to **Classic Ember**, NIE hashowany — `.msg-form__contenteditable` (×1) + `.msg-form__send-button.artdeco-button[type=submit]` (×1) ISTNIEJĄ. **Selektory obecnego kodu są POPRAWNE.** Moja diagnoza na żywo „oś #5: zły selektor SDUI" była BŁĘDNA — zmyliła mnie ściana Premium na nie-kontakcie (composer w ogóle się nie renderował → 0 pól) + inny hashowany `type=submit` w chrome strony SDUI. Klasyczny przypadek z reguły „verify dump before fixing": objaw = render/limit, nie parsowanie. Na koncie Marcina **chrome strony jest SDUI, ale widget composera pozostaje Ember** — jak overlay „Połącz".

**Wniosek po korekcie — bugów jest CZTERY, nie pięć.** Manipulacja DOM (selektory + wstawianie + klik) jest najpewniej OK. Realne przyczyny porażki: (1) zły URL `recipients=slug`, (2) zdobycie URN, (3) modale, (4) brama 1°. To znacząco UPRASZCZA T2 — to nie „przepisz pod SDUI", to „napraw URL + zamknij modale + bramka 1° + weryfikuj dostawę".

**Wniosek dla T2:** wysyłka = nawiguj na `/in/<slug>/` → odczytaj `recipient=URN` z przycisku Message (lub kliknij) → nawiguj na compose z URN → **zamknij modale** → wstaw tekst (solidnie, nie execCommand) → klik send (selektory **per wariant**: Ember vs SDUI) → **zweryfikuj dostawę**. Brama 1° przed całością.

**Bonus #56B:** lewy panel `/messaging/` renderuje listę rozmów z prefiksem „Ty:" (ostatni nadawca = ja), timestamp, imię — użyteczne do reply-trackera.

---

## 2. DoD per pętla (kryteria jako struktura — flip dopiero po realnej weryfikacji E2E)

### Pętla WYSYŁKA — DoD pojedynczej wysyłki
```json
{
  "criteria": [
    {"id": "recipient_resolved", "test": "jesteśmy na /in/<slug>/ i klik 'Wyślij wiadomość' otworzył overlay z TĄ osobą", "passes": false},
    {"id": "text_inserted", "test": ".msg-form__contenteditable zawiera dokładnie nasz tekst (model frameworka, nie tylko DOM)", "passes": false},
    {"id": "send_enabled", "test": ".msg-form__send-button !disabled po wstawieniu", "passes": false},
    {"id": "delivered", "test": "nasz tekst pojawił się jako OSTATNI wychodzący bąbel w wątku (.msg-s-event-listitem)", "passes": false}
  ]
}
```
> `delivered` to PRAWDZIWY DoD. „Form się wyczyścił" = słaby proxy (reguła #3: nie flipuj na sygnale niższym niż E2E). Weryfikacja = deterministyczna (DOM wątku), NIE LLM.

### Pętla ENRICHMENT — DoD pojedynczego kontaktu
```json
{
  "criteria": [
    {"id": "has_data_or_marked", "test": "profileDb[slug].headline niepuste LUB profileDb[slug].enrichStatus='unavailable' z timestampem", "passes": false},
    {"id": "no_infinite_retry", "test": "profil prywatny/niedostępny → marker 'unavailable', NIE re-scrape w kółko", "passes": false}
  ]
}
```

---

## 3. Zadania sprintu (DoD + bezpieczniki + stop)

### T0 — DUMP profil→Message (GATE, blokuje T2) ⛔ NAJPIERW
Zdobądź realny DOM, bez którego naprawa wysyłki to zgadywanie (reguła „verify dump before fixing").
- **Output**: fixtures `profile_message_button.html` (przycisk „Wyślij wiadomość" na /in/<slug>/) + `msg_overlay_composer.html` (dymek msg-overlay po kliknięciu).
- **Sposób**: Claude in Chrome (Marcin pre-autoryzował) ALBO ręczny `copy(document.body.outerHTML)`.
- **DoD**: oba fixture istnieją; zidentyfikowane selektory: (a) przycisk Message na profilu, (b) contenteditable w overlay, (c) send w overlay; node-test asercuje obecność selektorów.

### T1 — Odsprzęgnij enrichment od wysyłki
Osobny wolny worker enrichment (własny alarm), wypełnia profileDb **z wyprzedzeniem**. Tick wysyłki przestaje scrapować.
- **DoD**:
  - tick wysyłki zawiera **zero** wywołań scrape profilu (grep + test),
  - enrichment-worker wypełnia headline dla kontaktów z pustym,
  - **mutex**: enrichment ∦ wysyłka ∦ bulkConnect (nigdy równolegle — równoległość = sygnał bota).
- **Bezpieczniki**: cap dzienny, godziny 9-18, stop przy account-limit (redirect /in/→/mynetwork), idempotencja (marker 'unavailable').
- **Stop**: brak kontaktów do wzbogacenia OR cap OR account-limit.

### T2 — Naprawa wysyłki: profil→Message + solidne wstawianie (potrzebuje T0)
- Nawiguj `/in/<slug>/` (encoding sluga!) → klik „Wyślij wiadomość" → overlay → wstaw tekst **solidnie** (symulacja `paste`/`beforeinput`, NIE `execCommand`) → klik send → **zweryfikuj dostawę** (nasz tekst = ostatni wychodzący bąbel).
- **DoD**:
  - test na realnym DOM (fixture z T0) przechodzi — przy obecnym kodzie NIE ma żadnego,
  - smoke na żywo: 1 realna wiadomość ląduje w wątku (Marcin lub ja przez Chrome).
- **Bezpieczniki**: HITL przed wysyłką; **idempotencja** = przed compose sprawdź czy nasz tekst już nie jest ostatnim bąblem (ochrona przed double-send gdy karta padła po wysłaniu a przed zapisem `sent`); retry tylko transient (tab load, brak hydratacji), NIE na `redirected_off_profile`/`compose_not_found` po N próbach.

### T3 — Bramka anty-halucynacja (deterministyczny weryfikator, osobno od generacji)
Po odpowiedzi AI: deterministyczny check — brak nazwy firmy spoza faktów, brak fałszywej relacji („dzięki za połączenie", „miło było Cię poznać"), brak halucynowanego imienia gdy nieznane. Wykryto → regeneruj raz → fallback do szablonu/pomiń.
- **DoD**: test z spreparowanymi halucynacjami → wszystkie złapane (reguła #5: grader deterministyczny > LLM-sędzia; reguła #4: weryfikacja ≠ generacja).

### T4 — Formalizacja DoD + bezpieczników pętli wysyłki
- **Stop** = ukończenie OR cap_dzienny OR cap_konsekwentnych_faili (breaker, jest 3) OR poza_godzinami OR account_limit.
- **HITL**: pierwszy batch wymaga zatwierdzenia człowieka **nawet w trybie auto**.
- **Idempotencja**: klucz (campaignId, slug, stepNum); `sent` nigdy nie wysyła ponownie; zapis `sent` atomowy.
- **Log kroków**: każdy tick → kto/co/kiedy/wynik (odtwarzalność).
- **DoD**: każdy bezpiecznik ma test; runaway udowodniony jako niemożliwy (cap egzekwowany).

### T5 — Postawa bezpieczeństwa: ręczny domyślny + warm-up
- Tryb **ręczny = domyślny** (zero automatyzacji DOM = zero powierzchni detekcji). Auto = opt-in ze świadomą zgodą na ryzyko (research: 23% userów rozszerzeń = restrykcje w 90 dni).
- **Warm-up ramp** dla świeżego konta (5-10/dzień → w górę przez tygodnie), konfigurowalne.
- **DoD**: nowa kampania domyślnie ręczna; auto wymaga przełącznika + potwierdzenia; ramp konfigurowalny.

---

## 4. Sekwencja

```
T0 (GATE) ──► T2 (wysyłka) ──► T4 (DoD pętli) ──► T5 (postawa)
   │
   └─ równolegle: T1 (odsprzęgnięcie) ‖ T3 (anty-halucynacja)  [niezależne od T0]
```

---

## 5. Przejście przez czerwone flagi (skill)

- [x] Pętla bez górnego limitu? → NIE: cap dzienny + iteracji + breaker + godziny + account-limit (T4).
- [x] „Done" z samooceny modelu w tym samym callu? → NIE: dostawa weryfikowana z DOM wątku, jakość z deterministycznej bramki (T2, T3).
- [x] LLM-sędzia bez kalibracji? → NIE używamy LLM-sędziego; grader deterministyczny.
- [x] Akcja nieodwracalna bez zgody człowieka? → HITL przed wysyłką, ręczny domyślny (T4, T5).
- [x] Narzędzie piszące bez klucza idempotencji? → klucz (campaignId, slug, stepNum) + verify-before-send (T2, T4).
- [x] Brak logu kroków? → log per tick (T4).
- [x] Retry na nietransientne? → retry tylko transient; account-limit = stop bez retry (T1, T2).

---

## 6. Decyzje (2026-06-28, Marcin)

- **T0** → pobieram dump sam przez Claude in Chrome (odczyt DOM przycisku + overlay na 1 profilu, ZERO wysyłki).
- **T5** → **ręczny domyślny, auto opt-in** — ZATWIERDZONE. Nowa kampania domyślnie generuj→kopiuj→człowiek wysyła; auto-DOM-send tylko po świadomym włączeniu.

## 7. Co teraz

Wykonuję T0 (dump profil→Message przez Chrome). Po fixture: T2 (naprawa wysyłki). Równolegle gotowe do startu T1 (odsprzęgnięcie) i T3 (anty-halucynacja).
