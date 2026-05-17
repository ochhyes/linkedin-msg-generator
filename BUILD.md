# BUILD — wersja publikacyjna „Outreach"

Repo ma dwa foldery rozszerzenia:

| Folder | Nazwa w `chrome://extensions/` | Przeznaczenie |
|---|---|---|
| `extension/` | LinkedIn Message Generator | **Dev** — jedyne źródło prawdy, tu się koduje i commituje |
| `outreach/` | **Outreach** | **Publikacja** — wersja do rozdawania zespołowi, generowana automatycznie |

## Jak zbudować

Z korzenia repo:

```bash
node build.js
```

Skrypt:
1. Usuwa stare `outreach/` i tworzy je od nowa jako kopię `extension/`.
2. Wycina pliki dev: `tests/`, `node_modules/`, `dom_sample.txt`, `package*.json`, `README.md`.
3. W `outreach/manifest.json` podmienia `name` → **`Outreach`** oraz `key` na **osobny klucz publikacyjny**.

`build.js` nie ma zależności (czysty Node). Po **każdej** zmianie w `extension/` uruchom go ponownie — `outreach/` jest artefaktem builda (gitignored), **nigdy nie edytuj go ręcznie**.

## Dlaczego osobny `key`

`outreach/` ma inny `key` w manifeście niż `extension/` → **inne, stabilne ID rozszerzenia**. Dzięki temu:
- oba foldery można załadować przez Load Unpacked **obok siebie** bez kolizji ID,
- wersja „Outreach" ma własną, spójną tożsamość u wszystkich z zespołu.

Klucz prywatny pary leży w `.keys/outreach.pem` (gitignored — `*.pem`). Nie jest potrzebny do dystrybucji przez zip / Load Unpacked; trzymany na wypadek pakowania `.crx` w przyszłości. Klucz publiczny jest zaszyty w `build.js` (stała `PUB_KEY`) — **musi pozostać stały**, inaczej ID „Outreach" zmieniałoby się przy każdym buildzie.

## ⚠ Osobne ID = osobny storage

„Outreach" i dev mają różne ID → **osobny `chrome.storage.local`**. Przełączenie się z folderu dev na „Outreach" oznacza pustą kolejkę / pustą bazę profili w nowej instalacji. Żeby przenieść dane: w starym rozszerzeniu Dashboard → „Eksport JSON (pełny backup)", w nowym → „Import pliku" (zaznacz „przywróć kolejkę"). To samo tyczy się zespołu — każdy zaczyna z czystym storage.

## Dystrybucja zespołowi

1. `node build.js`
2. Spakuj folder `outreach/` do zip (Explorer: prawy klik na `outreach` → Wyślij do → Folder skompresowany).
3. Prześlij zip + `INSTRUKCJA.md`. Odbiorca: rozpakuj → `chrome://extensions/` → tryb dewelopera → „Wczytaj rozpakowane" → wskaż folder `outreach`.

Wersja (`version` w manifeście) jest dziedziczona z `extension/manifest.json` — bumpuj tam, jak dotąd.
