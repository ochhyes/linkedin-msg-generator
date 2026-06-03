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
4. **Pakuje wynik do `Outreach-<wersja>.zip`** w korzeniu repo (zawartość `outreach/`, `manifest.json` w korzeniu zipa) — gotowe do wysłania. Na Windows woła systemowy `Compress-Archive`, na Unixie `zip`; gdyby się nie udało, wypisuje komendę do ręcznego spakowania (build nie pada).

`build.js` nie ma zależności npm (czysty Node + systemowe narzędzie do zipa). Po **każdej** zmianie w `extension/` uruchom go ponownie — `outreach/` i `Outreach-*.zip` to artefakty builda (gitignored), **nigdy nie edytuj ich ręcznie**.

## Dlaczego osobny `key`

`outreach/` ma inny `key` w manifeście niż `extension/` → **inne, stabilne ID rozszerzenia**. Dzięki temu:
- oba foldery można załadować przez Load Unpacked **obok siebie** bez kolizji ID,
- wersja „Outreach" ma własną, spójną tożsamość u wszystkich z zespołu.

Klucz prywatny pary leży w `.keys/outreach.pem` (gitignored — `*.pem`). Nie jest potrzebny do dystrybucji przez zip / Load Unpacked; trzymany na wypadek pakowania `.crx` w przyszłości. Klucz publiczny jest zaszyty w `build.js` (stała `PUB_KEY`) — **musi pozostać stały**, inaczej ID „Outreach" zmieniałoby się przy każdym buildzie.

## ⚠ Osobne ID = osobny storage

„Outreach" i dev mają różne ID → **osobny `chrome.storage.local`**. Przełączenie się z folderu dev na „Outreach" oznacza pustą kolejkę / pustą bazę profili w nowej instalacji. Żeby przenieść dane: w starym rozszerzeniu Dashboard → „Eksport JSON (pełny backup)", w nowym → „Import pliku" (zaznacz „przywróć kolejkę"). To samo tyczy się zespołu — każdy zaczyna z czystym storage.

## Dystrybucja zespołowi

**To jest ostatni krok KAŻDEGO release'u dotykającego `extension/`** (zob. DEFINITION OF DONE w `CLAUDE.md`) — dopóki nie ma paczki, zespół wciąż siedzi na starej wersji z bugiem.

1. `node build.js` — generuje `outreach/` **i automatycznie pakuje** `Outreach-<wersja>.zip` w korzeniu repo (manifest.json w korzeniu zipa). Gdyby auto-zip zawiódł, skrypt wypisze komendę ręczną:
   ```powershell
   $v=(Get-Content extension\manifest.json -Raw|ConvertFrom-Json).version; Compress-Archive -Path outreach\* -DestinationPath "Outreach-$v.zip" -Force
   ```
2. Prześlij `Outreach-<wersja>.zip` + `INSTRUKCJA.md`. Odbiorca: rozpakuj → `chrome://extensions/` → tryb dewelopera → „Wczytaj rozpakowane" → wskaż rozpakowany folder (np. `Outreach-1.25.3`).

**Upgrade u odbiorcy, który ma już dane:** nadpisz pliki w jego dotychczasowym folderze „Outreach" → **Reload** (↻). **NIGDY „Usuń" + dodaj** — Remove kasuje `chrome.storage.local` (bazę/kolejkę), `key` chroni tylko ID. Pierwsza instalacja: po prostu „Wczytaj rozpakowane".

Konwencja nazwy: `Outreach-<wersja>.zip` (np. `Outreach-1.25.3.zip`); zipy są gitignored (`Outreach-*.zip`). Wersja (`version` w manifeście) dziedziczona z `extension/manifest.json` — bumpuj tam, jak dotąd.
