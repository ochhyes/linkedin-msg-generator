# UX Redesign — OVB Professional Minimal

> **Cel:** wymienić obecny "discord-blue dev tool" look na korporacyjny minimalist OVB.
> **Scope:** popup (380→400px), dashboard (1100px), options, opcjonalnie nowe ikony extension'a.
> **Zachować:** całą logikę popup.js/dashboard.js — tylko warstwa wizualna.

---

## 1. Audit obecnego stanu — co nie gra

| Problem | Gdzie | Dlaczego źle |
|---|---|---|
| Generic "discord blue" `#4f8ff7` na czarnym tle | wszędzie | Wygląda jak Discord/dev tool, nie korporacja finansowa. Zero brand identity. |
| Dark mode jako default | popup.css, dashboard.css | Target audience OVB (30-55 lat, doradcy finansowi) preferują light mode. Dark = "techies". |
| Gęste paddingi 8-12px | header, tabs, cards | Brak oddechu. UI wygląda "wciśnięty". |
| Action bar 4-5 przycisków w rzędzie | popup.html linie 209-234 | Wizualny chaos. Primary CTA się gubi. |
| 6 różnych "badge" / "status" stylów | bulk-queue, message-pipeline, followup, tabs | Niespójność. Każda sekcja wymyślała swoje kolory. |
| SVG icons inline z różną stroke-width | popup.html header + buttons | Stylistyczny chaos. Niektóre 2px stroke, inne placeholder z LinkedIn'a. |
| Brak typograficznej hierarchii | wszędzie | Wszystko ma podobny font-size (11-14px). Niemożliwe szybkie scanowanie. |
| Tabs z `text-transform: uppercase` + letter-spacing | `.tab` w popup.css | Anachronizm 2018. Współczesne UI używa sentence case. |
| Border-radius mieszany (4/6/8/999) | różne miejsca | Niespójność. Powinien być jeden 6px + 999 dla pills. |
| `Segoe UI` jako primary | `--font` | Windows-only. Inter / system stack lepsze. |
| Czerwone badge'y `#d32f2f` (followup-count-badge) | dashboard | Material Design 2014 czerwień. Brak harmonii z resztą. |
| Inline `#1a1d24` w `.bulk-connect` | popup.css linia 572 | Hardcoded value, nie var. Skraca refactor. |

---

## 2. Design tokens — OVB Minimal

### 2.1. Paleta

OVB Allfinanz w identyfikacji wizualnej używa **głębokiego granatu** z białym/szarym. Czerwień jako akcent jest opcjonalna — w nowoczesnych wariantach OVB jej unika. Idziemy w czysty granat + neutrale.

```css
:root {
  /* ── Brand ─────────────────────────────────────────────── */
  --brand-primary: #002A5C;        /* OVB navy — primary CTA, links, accent */
  --brand-primary-hover: #001F47;  /* darker hover */
  --brand-primary-soft: #E8EEF6;   /* tinted bg dla hover/selected states */
  --brand-secondary: #6B7785;      /* neutral medium — secondary text */

  /* ── Neutrals (light mode) ─────────────────────────────── */
  --bg: #FFFFFF;
  --bg-subtle: #FAFBFC;            /* sekcje subtelnie podniesione */
  --bg-muted: #F1F3F5;             /* input fields, hover states */
  --border: #E1E5EB;               /* default borders */
  --border-strong: #C8D0D9;        /* focus, emphasized */
  --text: #1A202C;                 /* primary text */
  --text-secondary: #4A5563;       /* labels, captions */
  --text-muted: #6B7785;           /* timestamps, meta */
  --text-disabled: #A0AAB8;

  /* ── Semantic ──────────────────────────────────────────── */
  --success: #0A7849;              /* zielony — finansowy, nie neon */
  --success-soft: #E8F4EE;
  --warning: #B8731F;              /* bursztyn, nie żółty */
  --warning-soft: #FBF3E5;
  --error: #C8102E;                /* OVB-acceptable czerwień, tylko dla errors */
  --error-soft: #FBE9EC;

  /* ── Spacing scale (4-base) ────────────────────────────── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  /* ── Radii ─────────────────────────────────────────────── */
  --radius-sm: 4px;       /* badges */
  --radius: 6px;          /* default — buttons, inputs, cards */
  --radius-lg: 8px;       /* large containers */
  --radius-pill: 999px;   /* chips, count badges */

  /* ── Shadows (subtle, premium feel) ────────────────────── */
  --shadow-sm: 0 1px 2px rgba(0, 42, 92, 0.04);
  --shadow: 0 2px 8px rgba(0, 42, 92, 0.06);
  --shadow-lg: 0 8px 24px rgba(0, 42, 92, 0.08);

  /* ── Typography ────────────────────────────────────────── */
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", Consolas, monospace;

  /* ── Transitions ──────────────────────────────────────── */
  --transition: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);

  /* ── Layout ───────────────────────────────────────────── */
  --popup-width: 400px;
  --header-height: 56px;
  --tabs-height: 44px;
  --action-bar-height: 64px;
}

/* Dark mode jako opcjonalna nadpisana wersja */
@media (prefers-color-scheme: dark) {
  :root[data-theme="auto"] {
    --bg: #0F1216;
    --bg-subtle: #161A20;
    --bg-muted: #1F242B;
    --border: #2A2F37;
    --border-strong: #3A4049;
    --text: #E8EBF0;
    --text-secondary: #B5BCC8;
    --text-muted: #8B92A0;
    --brand-primary: #5B9CFF;        /* lighter dla kontrastu na ciemnym */
    --brand-primary-soft: rgba(91, 156, 255, 0.12);
  }
}
```

### 2.2. Typografia — skala

```css
/* Inter via CDN — w <head> popup.html i dashboard.html: */
/* <link rel="preconnect" href="https://rsms.me"> */
/* <link rel="stylesheet" href="https://rsms.me/inter/inter.css"> */

/* Display (rzadkie, tylko hero) */
--text-display: 24px / 1.2 / 700;

/* Headings */
--text-h1: 18px / 1.3 / 600;        /* popup view title, dashboard h1 */
--text-h2: 15px / 1.4 / 600;        /* sekcje */
--text-h3: 13px / 1.4 / 600;        /* sub-sekcje */

/* Body */
--text-body: 13px / 1.5 / 400;      /* default */
--text-body-strong: 13px / 1.5 / 500;

/* Small */
--text-sm: 12px / 1.5 / 400;        /* captions, labels */
--text-xs: 11px / 1.4 / 500;        /* badges, timestamps */
```

**Zasady:**
- Hierarchy przez **weight + size**, NIE przez kolor. Kolor = function (success/error), nie weight.
- Sentence case wszędzie. **ZERO** uppercase + letter-spacing styling.
- Headings 600 weight (nie 700 — too heavy). 700 zarezerwowane dla display.
- Body 400, labels 500.
- Numbers tabular: `font-variant-numeric: tabular-nums` na liczbach (queue progress, statystyki, timestampy).

### 2.3. Iconografia

**Wymień SVG inline na Lucide** (open source, MIT, spójny styl, stroke 1.5px, używają wszyscy w 2026 — Vercel, Linear, Stripe).

Setup w extension: bundle SVG sprite albo import jako data-URI w CSS. Bez external dependency.

Mapping ikon (obecne → Lucide):
- `chat` (header) → `lucide-messages-square`
- `settings` → `lucide-settings-2`
- `user` (scrape) → `lucide-user-search`
- `lightning` (generate) → `lucide-sparkles` (AI vibe, nie generic "fast")
- `copy` → `lucide-copy`
- `reload` (refresh) → `lucide-refresh-cw`
- `target` (bulk URL hint) → `lucide-target` (zamiast emoji 📍)
- `chart-bar` (dashboard) → `lucide-bar-chart-3`
- `inbox` (empty state) → `lucide-inbox`

Size scale: **16px** w przyciskach, **20px** w header, **24px** w empty states.

Stroke width **1.5px** (Lucide default — bardziej elegancki niż obecny 2px).

---

## 3. Kluczowe komponenty — przed/po

### 3.1. Header (popup)

**Przed:** ciemne tło, lewa strona ikona+tytuł, prawa strona dwie ikony rzędem.

**Po:**
```
┌────────────────────────────────────────────────────────┐
│  [OVB logo]  Outreach            [dashboard] [⚙]      │
│              ↑ 15px / 600 / brand-primary              │
└────────────────────────────────────────────────────────┘
   border-bottom: 1px var(--border)
   background: var(--bg)
   padding: 14px 20px
   height: 56px
```

- Logo OVB (24×24) zamiast generic chat icon.
- Tytuł: **"Outreach"** zamiast "LinkedIn MSG" (krótko, brandowo).
- Pod tytułem maleńki tagline `OVB Allfinanz` (10px, `--text-muted`) — opcjonalnie.
- Prawe ikony: 2 sztuki, 32×32 hit area, 18px icon.

### 3.2. Tabs

**Przed:** uppercase + letter-spacing, 11px font.

**Po:**
```
┌────────────────────────────────────────────────────────┐
│  Profil      Bulk        Follow-upy [3]                │
│  ────────                                              │
│  ↑ 13px / 500 / sentence case                          │
│  active: text=brand-primary, underline 2px brand       │
└────────────────────────────────────────────────────────┘
   padding: 14px 8px
   height: 44px
```

- Sentence case. ZERO uppercase.
- Badge w follow-upy: pill `--radius-pill`, `--brand-primary`, 11px / 500.

### 3.3. Buttons

**Przed:** 4 typy (`primary`, `secondary`, `outline`, `small`, `danger`), `9px 14px` padding.

**Po — uproszczony system 3 typy:**

```css
.btn {
  height: 36px;
  padding: 0 16px;
  font: 500 13px var(--font);
  border-radius: var(--radius);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: var(--transition);
  border: 1px solid transparent;
}

/* Primary — solid brand */
.btn--primary {
  background: var(--brand-primary);
  color: white;
}
.btn--primary:hover { background: var(--brand-primary-hover); }

/* Secondary — outlined */
.btn--secondary {
  background: var(--bg);
  color: var(--text);
  border-color: var(--border-strong);
}
.btn--secondary:hover {
  background: var(--bg-muted);
  border-color: var(--text-muted);
}

/* Ghost — borderless, do mniej ważnych akcji */
.btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}
.btn--ghost:hover {
  background: var(--bg-muted);
  color: var(--text);
}

/* Size modifier */
.btn--sm { height: 28px; padding: 0 12px; font-size: 12px; }
.btn--lg { height: 40px; padding: 0 20px; font-size: 14px; }

/* Danger — destruktywne (Stop, Wyczyść) */
.btn--danger {
  background: var(--error-soft);
  color: var(--error);
  border-color: transparent;
}
.btn--danger:hover {
  background: var(--error);
  color: white;
}

/* Focus ring zawsze brand */
.btn:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
}
```

**Reguła:** w jednym widoku **maks. 1 primary**. Reszta secondary/ghost.

### 3.4. Action bar (popup bottom)

**Przed:** 5 przycisków na raz (Pobierz / Generuj / Kopiuj / Kopiuj+śledź / Nowa wersja).

**Po:**
- **Faza 1** (no profile): jeden duży primary `Pobierz profil` (40px, fullwidth).
- **Faza 2** (profile scraped, no message): jeden primary `Generuj wiadomość`, ghost `Zmień ustawienia`.
- **Faza 3** (message ready): primary `Kopiuj i śledź`, ghost `Nowa wersja`, ghost `Kopiuj tylko`.

Trzy stany progresywne. **Nigdy więcej niż 3 przyciski naraz.**

Visual:
```
┌────────────────────────────────────────────────────────┐
│  [    Pobierz profil    ]                              │  ← faza 1
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [ Zmień ustawienia ]    [  Generuj wiadomość  ]      │  ← faza 2
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  [↻ Nowa] [Kopiuj]       [Kopiuj i śledź →]           │  ← faza 3
└────────────────────────────────────────────────────────┘
```

### 3.5. Cards (profile, queue items, follow-up rows)

**Przed:** różne style dla każdego typu, `--bg-elevated` hardcoded.

**Po — jeden card system:**

```css
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
  transition: var(--transition);
}

.card:hover {
  border-color: var(--border-strong);
}

.card--interactive { cursor: pointer; }
.card--interactive:hover {
  border-color: var(--brand-primary);
  background: var(--brand-primary-soft);
}

.card--accent {
  border-left: 3px solid var(--brand-primary);
  padding-left: calc(var(--space-4) - 3px);
}

.card--warning { border-left: 3px solid var(--warning); }
.card--success { border-left: 3px solid var(--success); }
.card--muted { background: var(--bg-subtle); }
```

### 3.6. Status badges — jeden system

**Przed:** 6 różnych badge stylów (queue status, message status, follow-up tag, degree badge).

**Po — generic + modyfikatory:**

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  height: 20px;
  font: 500 11px var(--font);
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-secondary);
}

.badge--brand   { background: var(--brand-primary-soft); color: var(--brand-primary); }
.badge--success { background: var(--success-soft);       color: var(--success); }
.badge--warning { background: var(--warning-soft);       color: var(--warning); }
.badge--error   { background: var(--error-soft);         color: var(--error); }

/* Z kropką statusową */
.badge--dot::before {
  content: "";
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* Pulsujący dla "active" */
.badge--pulse::before {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

Użycie:
- Connect-able profile → `badge badge--success badge--dot`
- Pending → `badge badge--warning badge--dot`
- 1st degree → `badge` (default neutral)
- Queue active → `badge badge--brand badge--dot badge--pulse`
- Replied → `badge badge--brand`

### 3.7. Inputs

```css
.input, .select, .textarea {
  height: 36px;
  padding: 0 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: 400 13px var(--font);
  color: var(--text);
  transition: var(--transition);
}

.input:hover, .select:hover {
  border-color: var(--border-strong);
}

.input:focus, .select:focus, .textarea:focus {
  outline: none;
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 3px var(--brand-primary-soft);
}

.textarea {
  min-height: 80px;
  padding: 8px 12px;
  height: auto;
  resize: vertical;
}

.label {
  display: block;
  font: 500 12px var(--font);
  color: var(--text-secondary);
  margin-bottom: 4px;
}
```

**Zmiana z obecnego:** focus daje **shadow ring** zamiast tylko border-color change. To industry standard (Stripe, Vercel, Linear).

### 3.8. Empty states

Każda lista/sekcja bez danych = nie pusta przestrzeń, tylko ilustrowany empty state:

```html
<div class="empty">
  <svg class="empty__icon"><!-- Lucide inbox 32px --></svg>
  <p class="empty__title">Brak follow-upów</p>
  <p class="empty__text">Profile pojawią się tu po wysłaniu pierwszej wiadomości.</p>
</div>
```

```css
.empty {
  text-align: center;
  padding: var(--space-8) var(--space-4);
  color: var(--text-muted);
}
.empty__icon {
  width: 32px; height: 32px;
  color: var(--text-disabled);
  margin-bottom: var(--space-3);
}
.empty__title {
  font: 500 13px var(--font);
  color: var(--text-secondary);
  margin: 0 0 4px;
}
.empty__text {
  font: 400 12px var(--font);
  margin: 0;
}
```

---

## 4. Plan implementacji dla Claude Code (Sprint #7)

Sprint #7 — "UX Redesign OVB Minimal" — uruchamiany **po** Sprint #6 (SDUI extractor v1.12.0, zamknięty 2026-05-11). Nie blokuje produktu, ale podnosi profesjonalizm przed szerszą dystrybucją zespołowi.

Estymata: **3-4 sprinty Marcin'a** (4-7 dni kalendarzowych). Idealna pod subagenty bo dotyka 6 plików niezależnie.

> **Numeracja tasków** `#23-#28` w tej sekcji to placeholdery z pierwszej wersji draft'u (Sprint #4 przed renumber). Przy starcie sprintu PM nadaje aktualne ID (kolejny po `#44 button Stop bulk` z v1.11.5).

### Sprint #7 — dekompozycja na 6 podtasków

**#23 P1 — Design tokens (1 sprint Marcina)**

Pliki: `extension/popup.css`, `extension/dashboard.css`, `extension/options.css`.

Kroki:
1. Wymień całą sekcję `:root` w popup.css na nowe tokeny z sekcji 2.1.
2. To samo w dashboard.css i options.css.
3. Dorzuć `<link>` do Inter w `<head>` wszystkich HTML.
4. Manifest bump: 1.x.x → 1.(x+1).0 (minor).
5. **NIE TKNIJ** żadnego komponentu jeszcze — sam refactor tokenów. Wszystko będzie wyglądać brzydko (kolory niespasowane z hardcoded values), to OK, zostaje na następne taski.

AC:
- [ ] Otwarcie popup'a po reload pokazuje light theme.
- [ ] Brak crash'a/blank screen — wszystkie komponenty się renderują, choćby nieładnie.
- [ ] DevTools: `getComputedStyle(document.body).getPropertyValue('--brand-primary')` zwraca `#002A5C`.

Subagent prompt:
```
You're refactoring CSS tokens for the LinkedIn Outreach extension.
Replace :root sections in extension/popup.css, dashboard.css, options.css
with new tokens from UX_REDESIGN.md section 2.1. Add Inter font link
to <head> of all three HTML files (popup.html, dashboard.html, options.html).
DON'T modify any component CSS — just the :root and HTML head sections.
After: bump manifest.json minor version.
Report which files changed and run pre-commit hook for syntax check.
```

**#24 P1 — Header + Tabs refactor (1 sprint Marcina)**

Pliki: `extension/popup.css` (sekcje `.header`, `.tabs`, `.tab`), `extension/popup.html` (header structure, tab labels).

Kroki:
1. Header refactor per sekcja 3.1 (logo placeholder 24×24, "Outreach" jako tytuł, 56px height).
2. Tabs refactor per sekcja 3.2 (sentence case, 44px height, 13px / 500).
3. Replace SVG inline icons w header'ze na Lucide (messages-square, settings-2).
4. Update `--header-height` i `--tabs-height` (już w tokenach).

AC:
- [ ] Header light bg, brand-primary tytuł, 56px wysoki.
- [ ] Tabs sentence case, underline na active, NIE uppercase.
- [ ] Hover na tab → text color change smooth (150ms).
- [ ] Brak regresji — kliknięcie tabu nadal przełącza widok.

**#25 P1 — Buttons + Action bar refactor (1 sprint Marcina)**

Pliki: `extension/popup.css` (sekcja `.btn*` + `.action-bar`), `extension/popup.js` (logika faza 1/2/3 actionbar'a).

Kroki:
1. Wymień `.btn--*` na 3 typy z sekcji 3.3 (primary/secondary/ghost) + size modyfikatory.
2. Refactor `.action-bar` na 3-fazowy state machine z sekcji 3.4. W `popup.js`: dodaj `renderActionBar(phase)` gdzie `phase ∈ {'no_profile', 'profile_no_message', 'message_ready'}`.
3. Pokazuj/ukryj przyciski zgodnie z fazą — usuń pokazywanie wszystkich naraz.
4. Replace SVG inline na Lucide (user-search, sparkles, copy, refresh-cw).

AC:
- [ ] Bez profilu: tylko primary "Pobierz profil" widoczny, fullwidth.
- [ ] Po scrape: primary "Generuj wiadomość" + ghost "Zmień ustawienia".
- [ ] Po generate: 3 przyciski max — primary "Kopiuj i śledź", ghost "Kopiuj", ghost "Nowa wersja".
- [ ] Manual click na "Pobierz profil" → button znika, pojawia się Generuj. UX nie utyka.

**#26 P2 — Cards + Badges unifikacja (1 sprint Marcina)**

Pliki: `extension/popup.css`, `extension/dashboard.css`, oba HTML.

Kroki:
1. Wymień `.profile-card`, `.followup-row`, `.message-item`, `.bulk-queue__item`, `.bulk-connect__row` na unified `.card` z sekcji 3.5 + modyfikatory.
2. Wymień wszystkie badge'y (`.bulk-queue__status--*`, `.message-item__status--*`, `.badge--*`, `.followup-row__tag*`) na unified `.badge` z sekcji 3.6.
3. W HTML zaktualizuj klasy ręcznie (Find & Replace per plik).
4. `popup.js` i `dashboard.js`: gdy gdzieś renderują badge przez `innerHTML += ...`, zaktualizuj template strings.

AC:
- [ ] Wszystkie listy mają ten sam card style (border, hover, focus).
- [ ] Wszystkie status indicators używają jednego `.badge` system'u.
- [ ] Pulsujący dot dla "active queue" działa.
- [ ] Dashboard `block--due/scheduled/history` używa `.card--warning/.card--accent/.card--muted`.

**#27 P2 — Empty states + Inputs polish (0.5 sprint Marcina)**

Pliki: `extension/popup.css`, `extension/dashboard.css`, HTML.

Kroki:
1. Każda lista bez danych dostaje empty state z sekcji 3.8 (ikona Lucide + title + text). Lokalizacje: bulk profile list, queue, follow-up due, follow-up scheduled, message pipeline, dashboard history, dashboard contacts.
2. Inputs: refactor per sekcja 3.7 (focus shadow ring, label component).
3. Settings view (popup) i options.html: zastosuj nowy input style.

AC:
- [ ] Otwarcie popup'a bez profilu pokazuje empty state z ikoną + tekstem instrukcji.
- [ ] Focus na input → niebieski outline + shadow ring, nie tylko border change.
- [ ] Wszystkie listy z `hidden` empty messages mają fallback empty state komponenty.

**#28 P3 — Dashboard cleanup + Stats funnel polish (1 sprint Marcina)**

Pliki: `extension/dashboard.css`, `extension/dashboard.html`, `extension/dashboard.js`.

Kroki:
1. Stats funnel section: replace `.stats-funnel` na grid 2-kolumnowy z liczbami w `font-variant-numeric: tabular-nums`, brand-primary dla TOTAL row.
2. Contacts table: replace HTML `<table>` styling na nowe tokeny. Sticky header. Hover row → `--brand-primary-soft` bg.
3. Header dashboard'u: brand-primary heading "Outreach Dashboard" zamiast "Dashboard follow-upów" (spójność z popup'em).
4. Refresh button → `.btn--ghost` z Lucide refresh-cw icon.

AC:
- [ ] Dashboard wygląda jak rozszerzona wersja popup'a — ta sama paleta, typografia, komponenty.
- [ ] Liczby w stats wyrównane (tabular-nums).
- [ ] Hover na wiersz tabeli kontaktów pokazuje brand-soft tint.

### Kolejność i parallelizacja

Sprint #7 dla Claude Code z subagentami:

```
Sesja 1: #23 (tokens) — solo, główny Claude. ~30 min.
         (musi być pierwszy — reszta zależy od tokenów)

Sesja 2: #24 + #25 równolegle przez 2 subagenty. ~1h.
         (header/tabs i buttons/action-bar dotykają tylko popup.{css,html,js})

Sesja 3: #26 (cards/badges) — duża, subagent A na popup, subagent B na dashboard. ~1.5h.
         (rozdzielone po plikach — A nie tknie dashboard.css, B nie tknie popup.css)

Sesja 4: #27 + #28 równolegle. ~1h.
         (empty states + dashboard polish — różne pliki)

Sesja 5: visual regression manual smoke + bug fixe. ~1h.
```

Łącznie **~5h faktycznej pracy + ~3h Marcina na smoke i tweaki = 1 tydzień ad-hoc**.

---

## 5. Asset generation — prompty graficzne

### 5.1. Ikony extension'a (icon16.png, icon48.png, icon128.png)

Obecne ikony są placeholder'em. Zamień na markowe.

**Prompt do Midjourney v6 / DALL-E 3:**

```
Minimalist app icon for a LinkedIn outreach tool by OVB Allfinanz,
deep navy blue background (#002A5C), single white geometric symbol
combining a speech bubble and a connection node, flat design,
no text, no gradient, ultra-clean professional corporate aesthetic,
suitable as a Chrome extension icon, square format,
inspired by Linear and Stripe app icons, vector style, 1024x1024.
```

**Alternatywny — bardziej abstrakcyjny:**

```
Square app icon, navy blue background #002A5C, centered white
abstract mark formed by two connected dots with a line bending
into a chat bubble tail, minimalist flat vector, no shadows,
no gradients, no text, professional financial services aesthetic,
rounded square 24px border-radius, 1024x1024 png with transparent
edge padding.
```

**Output:** PNG 1024×1024, ręcznie skaluj do 16/48/128 w GIMP albo Figmie (Squoosh.app może też). Zapisz w `extension/icons/`.

**Tip:** wygeneruj 4-6 wariantów, wybierz jeden, potem poproś Claude'a w Code'zie żeby zoptymalizował PNG (`pngquant` + `oxipng` w bash).

### 5.2. Logo do popup header (24×24 SVG inline)

**Prompt:**

```
A simple line-art SVG icon, 24x24 viewBox, stroke 1.5px, no fill,
representing professional networking — abstract design with
two circles connected by a line that curves into a small chat
bubble shape, monochromatic, suitable to render in #002A5C navy
color via currentColor CSS, no gradients, no text, vector logo
style. Output: SVG code I can paste into HTML inline.
```

Realnie: poproś bezpośrednio Claude'a w Code'zie żeby napisał SVG ręcznie — lepiej ci się sprawdzi niż AI-generated SVG (które często jest nieczyste, nadmiarowe paths). Prompt:

```
Write an inline SVG, 24x24 viewBox, stroke="currentColor"
stroke-width="1.5" fill="none". Two circles (one filled, one
outline) connected by a curved line that ends in a small chat
bubble tail. Clean, geometric, professional. Output: raw SVG
ready to paste in HTML.
```

### 5.3. Empty state illustrations (opcjonalnie)

Jeśli chcesz iść głębiej (Linear / Notion-style empty states):

```
Minimalist line-art illustration, 120x120, monochromatic navy blue
#002A5C on white background, professional and friendly, showing
an empty inbox / mailbox with soft geometric shapes around it,
generous negative space, flat vector style, no text, no faces,
suitable as empty state graphic in a B2B SaaS app.
```

Variants do wygenerowania:
- Empty profile list
- Empty queue
- All follow-ups done (success vibe, checkmark + leaf)
- No search results

Storage: `extension/icons/empty-{name}.svg`.

### 5.4. Branding asset list (final deliverable)

Do wygenerowania przed Sprintem #4 lub w trakcie #24:

| Plik | Format | Wymiary | Cel |
|---|---|---|---|
| `icons/icon16.png` | PNG | 16×16 | Toolbar icon |
| `icons/icon48.png` | PNG | 48×48 | Extensions page |
| `icons/icon128.png` | PNG | 128×128 | Chrome Web Store (gdyby kiedyś) |
| `icons/logo.svg` | SVG inline | 24×24 viewBox | Popup header |
| `icons/empty-inbox.svg` | SVG | 120×120 | Empty list states |
| `icons/empty-done.svg` | SVG | 120×120 | "All done" states |

---

## 6. Inspiracje wizualne — co researchować

Pokaż to Claude'owi w Code'zie razem z dokumentem żeby miał wzorce:

- **Linear** — typografia + spacing system. https://linear.app
- **Stripe Dashboard** — corporate minimal + tabular nums. https://stripe.com/docs
- **Vercel Dashboard** — empty states + brand-primary buttons.
- **Notion** — clean tables, hover states, sticky headers.
- **Anthropic Console** — current Claude UI, dobra paleta i typografia (relevant — feedback loop dla "wygląda profesjonalnie").

Anty-wzorce (czego NIE robić):
- Material Design 3 (zbyt opinionated, "Google-look").
- Bootstrap (zbyt generic, "2016 admin panel").
- Glassmorphism / gradients (już out-of-date 2026, korporacyjnie wygląda dziwnie).

---

## 7. TL;DR — co Marcin robi

1. **Sprint #6 (SDUI extractor) zamknięty 2026-05-11.** UX redesign jako Sprint #7 — czeka na decyzję Marcin'a kiedy startujemy (rozważ ROI: profesjonalny look vs dalsze feature'y).
2. **Wygeneruj asset'y** (sekcja 5) Midjourney/DALL-E w międzyczasie — 30 min, off-the-job. Zapisz do `extension/icons/` (favicony) i `extension/assets/` (WebP illustracje). *Stan 2026-05-11: zrobione — nowe `icon{16,48,128}.png` w icons/ + 4 WebP w assets/.*
3. **Otwórz Sprint #7 w Claude Code w VS Code** — pierwszy prompt:
   ```
   Read CLAUDE.md and UX_REDESIGN.md. We're starting Sprint #7
   (UX redesign). Act as PM — confirm the plan and tell me which
   asset files you need before first subtask can start.
   ```
4. **Wykonaj pierwszy subtask (tokens) solo, potem header/tabs + buttons parallel** (subagent prompts są w sekcji 4).
5. **Smoke** w Chrome po każdym task'u (Load Unpacked → reload → otwórz popup → sprawdź light theme + komponenty).
6. **Dystrybucja zespołowi OVB** — bump major do **2.0.0** (zmiana wizualna = breaking dla user'ów oczekujących starego widoku).

Po Sprincie #7 narzędzie wygląda jak profesjonalny tool OVB, nie homebrew Chrome extension. To podnosi adoption u zespołu i daje dobre "ammo" gdybyś chciał kiedyś rozszerzyć dystrybucję poza OVB.
