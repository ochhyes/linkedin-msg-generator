# LinkedIn Bulk Connect — DOM dump dla planu #19

**Data**: 2026-05-09
**URL**: `https://www.linkedin.com/search/results/people/?keywords=ovb`
**Profil testowy**: Gabriel Griffin (2nd degree)
**Język UI**: PL
**Kontekst**: Marcin nie ma Premium na tym koncie (brak "Wyślij teraz" buttona).

---

## TL;DR — 3 odkrycia które wywracają pierwotny plan

1. **Modal invite jest w Shadow DOM**, nie w głównym DOM. `document.querySelector('[role="dialog"]')` w głównym DOM łapie INNE dialogs LinkedIn (Opcje reklamy, "Nie chcę widzieć"), nie modal invite.
2. **Klasy buttonów na liście wyników są hashed/obfuscated** (`_6d8b36a8 _953ab0f0`...) i identyczne dla "Połącz" i "W toku". Tylko `aria-label` i `text` odróżniają stan.
3. **Wszystkie akcje na liście to `<a>`, nie `<button>`** — w tym "W toku" (klik = withdraw invite, nie disabled).

---

## A. Modal container

Modal siedzi w shadow root pojedynczego hosta na poziomie body:

```
<div id="interop-outlet"
     data-testid="interop-shadowdom"
     class="theme--light"
     style="width:100vw; position:absolute; z-index:500; visibility:visible">
  #shadow-root (open)
    └── <div data-test-modal=""
              role="dialog"
              tabindex="-1"
              size="medium"
              aria-labelledby="send-invite-modal"
              class="artdeco-modal artdeco-modal--layer-default send-invite">
```

| Pole | Wartość |
|---|---|
| Tag | `DIV` (nie `<dialog>`, nie web component) |
| `role` | `dialog` |
| `aria-modal` | **brak** (LinkedIn nie ustawia, focus trap robią ręcznie) |
| `aria-label` | brak |
| `aria-labelledby` | `send-invite-modal` (wskazuje na `<h2 id="send-invite-modal">`) |
| `id` | (puste) |
| `data-test-modal` | (atrybut obecny, wartość pusta) |
| `data-test-id` | brak |
| `tabindex` | `-1` |
| `size` | `medium` (custom attr, niestandardowy) |
| `class` | `artdeco-modal artdeco-modal--layer-default send-invite` |

**Selektor (od najmocniejszego):**

```js
const host = document.querySelector('[data-testid="interop-shadowdom"]');
const sr = host?.shadowRoot;
const dlg = sr?.querySelector('.send-invite');
// Fallback: sr?.querySelector('[aria-labelledby="send-invite-modal"]')
// Najsłabszy fallback (kolizyjny): sr?.querySelector('[data-test-modal][role="dialog"]')
```

Klasy w shadow DOM są **readable** (`artdeco-*` design system), w przeciwieństwie do hashed klas w głównym DOM.

---

## B. Buttony w modalu

W modalu są **3 buttony** (wszystkie enabled, wszystkie `type="submit"` — Artdeco quirk):

### B1. X close

| Pole | Wartość |
|---|---|
| Tag | `BUTTON` |
| `text` | (puste, ikona SVG) |
| `aria-label` | `Odrzuć` |
| `data-test-modal-close-btn` | (atrybut obecny, wartość pusta) ← **najmocniejszy selektor** |
| `class` | `artdeco-button artdeco-button--circle artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view artdeco-modal__dismiss` |
| Pozycja | bezpośrednio w `.send-invite` (NIE w footer) |

### B2. Dodaj notatkę (secondary, lewy)

| Pole | Wartość |
|---|---|
| Tag | `BUTTON` |
| `text` | `Dodaj notatkę` |
| `aria-label` | `Dodaj notatkę` |
| `data-test-*` | brak |
| `class` | `artdeco-button artdeco-button--2 artdeco-button--secondary ember-view mr1` |
| Pozycja | `<div class="artdeco-modal__actionbar ember-view text-align-right">` |

### B3. Wyślij bez notatki (primary, prawy)

| Pole | Wartość |
|---|---|
| Tag | `BUTTON` |
| `text` | `Wyślij bez notatki` |
| `aria-label` | `Wyślij bez notatki` |
| `data-test-*` | brak |
| `class` | `artdeco-button artdeco-button--2 artdeco-button--primary ember-view ml1` |
| Pozycja | `<div class="artdeco-modal__actionbar ember-view text-align-right">` |

### Brak "Wyślij teraz" Premium

Marcin nie ma Premium → modal pokazuje wyłącznie B2 i B3. Plan #19 powinien obsłużyć też wariant Premium gdzie pojawia się trzeci button "Wyślij teraz" (selektor po aria-label, fallback na `--primary`).

### Selektory rekomendowane (i18n-safe)

```js
// Send without note — primary po positioning + variant (działa PL/EN bez tłumaczenia)
dlg.querySelector('.artdeco-modal__actionbar button.artdeco-button--primary')

// i18n fallback (PL+EN aria-label)
dlg.querySelector(
  'button[aria-label="Wyślij bez notatki"], button[aria-label="Send without a note"]'
)

// Add note
dlg.querySelector('.artdeco-modal__actionbar button.artdeco-button--secondary')

// Close X — najsilniejszy bo data-attr stabilny
dlg.querySelector('button[data-test-modal-close-btn]')
```

---

## C. Tytuł + sekcja informacyjna

| Element | Treść |
|---|---|
| `<h2 id="send-invite-modal">` | `Możesz dodać notatkę do zaproszenia` |
| `<p class="display-flex">` (poniżej h2, w `.artdeco-modal__content`) | `Spersonalizuj zaproszenie dla użytkownika <strong>Gabriel Griffin</strong>, dodając notatkę. Członkowie LinkedIn częściej akceptują zaproszenia z notatką.` |
| Licznik zaproszeń (np. "Pozostało Ci X zaproszeń") | **brak** w pierwotnym widoku |
| `<textarea>` | **brak** w pierwotnym widoku |

**Textarea** pojawia się dopiero po kliknięciu "Dodaj notatkę" (variant z notatką). Nie sprawdziłem jego `maxlength` w tym dumpie żeby nie triggerować flow notatki — z dokumentacji LinkedIn wiadomo że limit to 300 znaków.

A11y-text spans (do screen readerów):
- `<span class="a11y-text">Początek zawartości okna dialogowego.</span>`
- `<span class="a11y-text">Koniec zawartości okna dialogowego.</span>`

---

## D. Selektor wejścia (z listy wyników → otwarcie modalu)

| Pole | "Połącz" (Gabriel) | "W toku" (Mariusz / Tomek) |
|---|---|---|
| Tag | `<a>` (NIE button, NIE disabled) | `<a>` (NIE button, NIE disabled) |
| `text` | `Połącz` | `W toku` |
| `aria-label` | `Zaproś użytkownika {Imię Nazwisko} do nawiązania kontaktu` | `W toku; kliknij, aby wycofać zaproszenie wysłane do użytkownika {Imię Nazwisko}` |
| `href` | obecny, zawiera `search-custom-invite` ✓ | obecny, **NIE** zawiera `search-custom-invite` (zawiera withdraw URL) |
| `aria-disabled` | `false` | `false` (klikalny — withdraw) |
| `disabled` (prop) | false | false |
| `class` | `_6d8b36a8 _953ab0f0 bb349d9f _1fc292eb d7aa8400 d9fcd881 _1073273e _20a10458 d777fe6a c6f424ca b4d861f1 _87169341 _36064fe8 _18847223 _4b770bcc` (hashed, **identyczne dla obu states**) | (te same klasy) |
| `data-test-*` | brak | brak |
| Parent container | `<div class="a1ed55af">` (hashed) | `<div class="a1ed55af">` (hashed) |
| Grandparent | `<div class="d07ec19f _18847223 _4b770bcc">` | (analogicznie) |

**KRYTYCZNE**: klasy hashed są **te same** dla "Połącz" i "W toku". Pierwotny plan zakładał że można selektować po klasie — nie można. Stan akcji jest zakodowany **wyłącznie** w `aria-label` + `text`.

### Selektor wejścia + filtr "skip pending"

```js
// Otwórz modal — tylko jeśli profil jeszcze NIE ma pending invite
const connectLink = li.querySelector(
  'a[href*="search-custom-invite"][aria-label^="Zaproś użytkownika"]'
);

// i18n EN fallback:
// 'a[href*="search-custom-invite"][aria-label^="Invite "]'

// Skip jeśli już pending (defensywnie):
const isPending = !!li.querySelector('a[aria-label^="W toku"], a[aria-label^="Pending"]');

if (!connectLink || isPending) return {skip: 'no_connect_link_or_pending'};
connectLink.click();  // LinkedIn intercepts <a href> → otwiera modal client-side, NIE nawiguje
```

---

## E. Zamknięcie modalu

### X close button

```js
dlg.querySelector('button[data-test-modal-close-btn]')
// aria-label="Odrzuć", class="...artdeco-modal__dismiss"
```

### Esc key

✅ **Esc zamyka modal** — sprawdzone w sesji (`computer.action: "key"` z `Escape`).

Po Esc:
- `interop-outlet.shadowRoot` traci dziecko `.send-invite` (modal zniknięty z DOM, nie tylko ukryty).
- Status profilu nie zmienia się — brak invite. (Zweryfikowane: Gabriel po Esc nadal pokazuje "Połącz", nie "W toku".)

W content.js — preferuj symulację Esc nad klikiem X (bardziej deterministyczne, działa nawet jeśli LinkedIn przesunie X):

```js
document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
// LUB:
host.shadowRoot.querySelector('button[data-test-modal-close-btn]')?.click();
```

---

## Status diff: "Połącz" vs "W toku" (state machine)

| State | Visible text | aria-label prefix | href contains | Może bulk-connect? |
|---|---|---|---|---|
| **Connectable** (Gabriel, Grzegorz) | `Połącz` | `Zaproś użytkownika ` | `search-custom-invite` | ✅ TAK |
| **Pending invite** (Mariusz, Tomek) | `W toku` | `W toku; kliknij, aby wycofać zaproszenie ` | (withdraw URL) | ❌ skip |
| **Connected (1st degree)** | (brak link, jest "Wiadomość" / "Message") | n/a | n/a | ❌ skip |
| **Premium variant** (3rd degree) | (czasem zamiast modalu otwiera InMail / paid feature) | n/a | n/a | needs handling |

**Ważne**: Nigdy nie filtruj po klasach — wszystkie hashed i identyczne między states. Tylko `aria-label` + `text` + `href`.

---

## Implikacje dla content.js (rewrite planu #19)

```js
// content.js
async function bulkConnectClick(slug) {
  const li = findLiBySlug(slug);
  if (!li) return {skip: 'li_not_found'};

  // 1. Skip jeśli już pending lub brak Połącz linka
  const connectLink = li.querySelector(
    'a[href*="search-custom-invite"][aria-label^="Zaproś użytkownika"]'
  );
  // EN fallback: a[href*="search-custom-invite"][aria-label^="Invite "]
  if (!connectLink) return {skip: 'not_connectable'};

  // 2. Click triggers shadow-DOM modal client-side (LinkedIn intercepts <a href>)
  connectLink.click();

  // 3. Wait for shadow-DOM modal (NIE document.querySelector!)
  const dlg = await waitForShadow(
    () => document.querySelector('[data-testid="interop-shadowdom"]')
            ?.shadowRoot
            ?.querySelector('.send-invite'),
    3000
  );

  if (!dlg) {
    // Modal-less flow: niektóre 2nd degree LinkedIn wysyła od razu bez modala.
    // Verify pending badge w obrębie li.
    return await verifyPendingBadge(li, 2000);
  }

  // 4. Click "Wyślij bez notatki" — primary po wariancie koloru (i18n-free)
  const sendBtn = dlg.querySelector(
    '.artdeco-modal__actionbar button.artdeco-button--primary'
  );
  // i18n fallback: dlg.querySelector(
  //   'button[aria-label="Wyślij bez notatki"], button[aria-label="Send without a note"]'
  // );
  if (!sendBtn) return {error: 'send_button_missing'};
  sendBtn.click();

  // 5. Verify: link "Połącz" zmienia się na "W toku" w głównym DOM
  return await verifyPendingBadge(li, 3000);
}

async function verifyPendingBadge(li, timeout) {
  return await waitFor(
    () => !!li.querySelector('a[aria-label^="W toku"], a[aria-label^="Pending"]'),
    timeout
  );
}

async function waitForShadow(check, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = check();
    if (result) return result;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}
```

---

## Edge cases zauważone w sesji OVB search

1. **Reklamy w liście** — `<div>` z "Wznów Premium za 0 zł" + "Możesz filtrować według odpowiednich umiejętności..." między wynikami. Filter po obecności `a[aria-label^="Zaproś"]` lub po właściwym kontenerze profilu (`a1ed55af` w aktualnym setupie, ale klasy hashed rotują).
2. **Mieszane states** — w 7 wynikach OVB miałem 2 pending + 5 connectable. Bulk script bez `isPending` filtra zatrzymałby się przy pierwszym pending bo modal się nie otworzy (klik na "W toku" otwiera withdraw, nie invite modal).
3. **`<dialog>` na poziomie body** — LinkedIn renderuje też `<dialog>` elements (Opcje reklamy, Nie chcę widzieć tej treści) z `[role="dialog"]` ale są **closed** (`open` attribute false, `offsetParent === null`). Globalny selektor `[role="dialog"]` w głównym DOM łapie je → false positives. Zawsze przez `interop-outlet.shadowRoot`.
4. **Podwójny click ochrona** — LinkedIn ma debounce na connect link, ale dla pewności w content.js dodaj 200ms delay między klikami w bulk loop.
5. **ARIA-disabled false na "W toku"** — link jest klikalny (otwiera withdraw), nie disabled. Nie filtruj po `aria-disabled`.

---

## Sanitized outerHTML modalu (referencja)

URL'e zostały zsanitized przed extract'em (`href="REDACTED"`, `src="REDACTED"`, `https://...` → `REDACTED_URL`).

```html
<div data-test-modal="" role="dialog" tabindex="-1"
     class="artdeco-modal artdeco-modal--layer-default send-invite"
     size="medium" aria-labelledby="send-invite-modal">
  <span class="a11y-text">Początek zawartości okna dialogowego.</span>

  <button aria-label="Odrzuć" id="ember80"
          class="artdeco-button artdeco-button--circle artdeco-button--muted
                 artdeco-button--2 artdeco-button--tertiary ember-view
                 artdeco-modal__dismiss"
          data-test-modal-close-btn="">
    <svg role="none" aria-hidden="true" class="artdeco-button__icon"
         width="24" height="24" viewBox="0 0 24 24"
         data-supported-dps="24x24" data-test-icon="close-medium">
      <use href="REDACTED" width="24" height="24"></use>
    </svg>
    <span class="artdeco-button__text"></span>
  </button>

  <div id="ember81" class="artdeco-modal__header ember-view">
    <h2 id="send-invite-modal">
      Możesz dodać notatkę do zaproszenia
    </h2>
  </div>

  <div id="ember82" class="artdeco-modal__content ember-view">
    <p class="display-flex">
      <span class="flex-1">
        Spersonalizuj zaproszenie dla użytkownika
        <strong>Gabriel Griffin</strong>, dodając notatkę.
        Członkowie LinkedIn częściej akceptują zaproszenia z notatką.
      </span>
    </p>
  </div>

  <div id="ember83" class="artdeco-modal__actionbar ember-view text-align-right">
    <button aria-label="Dodaj notatkę" id="ember84"
            class="artdeco-button artdeco-button--2 artdeco-button--secondary
                   ember-view mr1">
      <span class="artdeco-button__text">Dodaj notatkę</span>
    </button>
    <button aria-label="Wyślij bez notatki" id="ember85"
            class="artdeco-button artdeco-button--2 artdeco-button--primary
                   ember-view ml1">
      <span class="artdeco-button__text">Wyślij bez notatki</span>
    </button>
  </div>

  <span class="a11y-text">Koniec zawartości okna dialogowego.</span>
</div>
```

**Ember IDs (`ember80`, `ember81`...)** są runtime-generated — rotują przy każdym mount. Nie używaj jako selektory.

---

## Checklist do AC1-AC8 testów (#18)

- [x] Modal selector identified (shadow DOM via `interop-outlet`).
- [x] Connect link selector i18n-safe (`a[href*="search-custom-invite"][aria-label^="..."]`).
- [x] Send-without-note button selector (`button.artdeco-button--primary` w `actionbar`).
- [x] Pending state detector (`a[aria-label^="W toku"]`).
- [x] Esc closes modal (zweryfikowane).
- [ ] Premium "Send now" wariant — nie sprawdzony (Marcin nie ma Premium na tym koncie).
- [ ] Modal-less flow — nie sprawdzony (wszystkie 2nd degree w teście pokazały modal).
- [ ] Test 3rd degree behavior — nie sprawdzony.

---

## Co dalej

1. Marcin: kontynuuje testy AC1-AC8 z #18 (refresh popupu extension'u itp.).
2. Po dokończeniu #18 — przerobić plan #19 z tym dumpem.
3. Pytanie kontrolne: czy sprawdzić modal-less flow (3rd degree) i Premium variant w osobnej sesji, czy kompendium powyżej wystarczy?
