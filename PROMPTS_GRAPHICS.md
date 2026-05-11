# Prompty do generowania grafiki — OVB Outreach

> Kopiuj-wklej do Midjourney v6, DALL-E 3, ChatGPT (GPT-image-1), Ideogram albo Flux.
> Każdy asset ma 2-3 warianty stylistyczne — wygeneruj wszystkie, wybierz.

**Kolory referencyjne (skopiuj do każdego promptu jak nie złapie):**
- Primary navy: **#002A5C** (głęboki granat OVB)
- White: **#FFFFFF**
- Light bg: **#FAFBFC**

---

## 1. Extension icon (główny — toolbar Chrome, Chrome Web Store)

**Cel:** jedna PNG 1024×1024 którą później skalujesz do 16/48/128 (w [Squoosh.app](https://squoosh.app) albo `pngquant`).

### Wariant A — Geometric mark (rekomendowany, najczystszy)

**Midjourney v6:**
```
Minimalist square app icon, deep navy blue solid background #002A5C, centered white geometric mark formed by two circles connected by a curved line that bends into a small chat bubble tail at the end, flat vector design, no gradient, no shadow, no text, no human figures, professional corporate financial services aesthetic, ultra clean, inspired by Linear and Stripe app icons, 1024x1024 --ar 1:1 --style raw --stylize 50 --v 6
```

**DALL-E 3 / ChatGPT image:**
```
Generate a 1024x1024 square app icon for a professional B2B SaaS tool.
Solid deep navy background, exact hex #002A5C.
Centered white symbol: two small circles (one filled, one outline) connected by
a curved line that bends at the end into a tiny chat bubble tail.
Flat vector design. No gradients, no shadows, no text, no people.
Style: ultra-minimalist, corporate finance aesthetic, inspired by Linear/Stripe app icons.
Rounded square 24px border-radius (the icon shape itself stays square — 
the rounding will be applied later by Chrome).
```

### Wariant B — Single-letter monogram

**Midjourney v6:**
```
Square app icon, solid #002A5C navy background, large centered white letter O styled as a circular abstract mark, with a small chat bubble notch cut from its lower-right curve, geometric sans-serif, flat vector, no gradient, no shadow, no extra text, corporate minimalist, professional financial aesthetic, 1024x1024 --ar 1:1 --style raw --v 6
```

**DALL-E 3:**
```
1024x1024 app icon, solid navy #002A5C background. Centered: a large white letter "O"
rendered as a perfect circular ring, with a small triangular chat bubble tail
cut out of its lower-right edge, suggesting a speech bubble morphing from the O.
Geometric, sans-serif, flat vector, no gradients, no shadows, no decorative elements.
Professional corporate aesthetic.
```

### Wariant C — Abstract conversation

**Midjourney v6:**
```
Square app icon for outreach platform, solid #002A5C deep navy background, centered abstract white mark of two overlapping speech bubbles forming an infinity-like shape, flat vector geometric style, no gradient, no shadow, no text, minimalist corporate, inspired by Notion and Vercel branding, 1024x1024 --ar 1:1 --style raw --stylize 30 --v 6
```

**Tip:** wygeneruj 4-6 wariantów każdej opcji, połóż obok siebie, wybierz w którą stronę chcesz iść. Potem upscale + ewentualnie poproś modela o "vary subtle" dla finalu.

---

## 2. Logo do popup header (24×24 SVG inline)

**Najlepsza metoda:** NIE generuj rastrem. **Poproś Claude'a w VS Code Code'zie żeby napisał SVG ręcznie** — AI-gen SVG zwykle ma 50+ niepotrzebnych path'y, raster-trace'owany szum.

**Prompt do Claude'a w Code'zie:**
```
Write an inline SVG, viewBox="0 0 24 24", stroke="currentColor" stroke-width="1.5"
stroke-linecap="round" stroke-linejoin="round" fill="none".

The mark should be: two circles connected by a curved line. Left circle small
and filled (use fill="currentColor" only on that circle), right circle outline-only
slightly larger, line between them curves gently and ends with a small chat
bubble tail pointing down-right from the right circle.

Style: minimal, geometric, modern. Should render cleanly at 16px and 24px sizes.
Output: just the raw <svg>...</svg> code, no commentary, no wrapping.
```

Claude wypluje 5-10 linii SVG. Wklej do `extension/popup.html` w miejsce obecnej `<svg class="header__icon">`.

**Alternatywa — Iconify / Lucide:**
Jeśli nie chcesz custom logo, użyj gotowej ikony z [Lucide](https://lucide.dev):
- `messages-square` — najbliżej tematu outreach
- `send` — alternatywnie

Skopiuj SVG z Lucide → wklej → kolor przez `stroke="currentColor"` (CSS przekaże `var(--brand-primary)`).

---

## 3. Empty state illustrations (3 sztuki, 120×120 SVG)

**Cel:** ilustracje do pustych list (brak profilu, brak follow-upów, kolejka pusta).

### 3.1. Empty inbox — "Brak profilu / Brak danych"

**Midjourney v6:**
```
Minimalist line-art illustration, 1024x1024 square, monochromatic navy blue #002A5C lines on pure white #FFFFFF background, 1.5px line weight, single subject centered: an open empty inbox tray with two small geometric leaves floating above it, generous negative space, flat vector style, no shading, no gradients, no text, no people, no faces, friendly but professional, inspired by Linear and Notion empty states --ar 1:1 --style raw --v 6
```

**DALL-E 3:**
```
1024x1024 white background illustration in monochromatic navy #002A5C line-art style.
Subject: a simple empty mailbox or inbox tray, drawn in clean 1.5px geometric lines,
slightly tilted, with 2-3 small leaf or wind shapes floating above it.
Flat vector, no shading, no gradients, no fills (line-art only).
No text, no people, no logos. Plenty of negative space around the subject.
Style reference: Linear.app empty states, Notion onboarding illustrations.
```

### 3.2. All done — "Wszystkie follow-upy zrobione"

**Midjourney v6:**
```
Minimalist line-art illustration, 1024x1024, monochromatic navy #002A5C lines on white background, 1.5px stroke weight, single subject: a simple checkmark drawn inside a soft rounded square or circle, with two small celebratory dots or sparkles nearby, generous white space, flat vector style, no shading, no gradients, no text, friendly minimalist corporate aesthetic --ar 1:1 --style raw --v 6
```

**DALL-E 3:**
```
1024x1024 white background line-art illustration, monochromatic navy #002A5C.
Subject: a clean checkmark symbol drawn inside a soft rounded square (24px corner radius),
with 2-3 small sparkle or dot accents around it suggesting completion satisfaction.
1.5px line weight, flat vector, no fills, no shading, no gradients, no text.
Style: corporate friendly minimalism, similar to Stripe empty states.
```

### 3.3. Empty queue — "Brak kontaktów w kolejce"

**Midjourney v6:**
```
Minimalist line-art illustration, 1024x1024, monochromatic navy blue #002A5C on white background, 1.5px stroke, subject: three small empty rectangles stacked vertically representing an empty list or queue, with subtle dashed outlines, a small magnifying glass icon floating beside them, flat vector geometric style, no shading, no gradients, no text, no people, generous white space, professional minimalist B2B SaaS aesthetic --ar 1:1 --style raw --v 6
```

**DALL-E 3:**
```
1024x1024 white background line-art illustration in monochromatic navy #002A5C.
Subject: three horizontal rectangles stacked vertically (suggesting an empty list),
drawn with dashed 1.5px lines, with a small magnifying glass icon positioned to
the right side. Flat geometric vector style, no fills, no shading, no gradients.
No text, no logos, no people. Generous negative space.
Style: Linear and Vercel empty states.
```

**Po wygenerowaniu PNG'ów:** trzeba zrobić **SVG conversion** (bo używamy w extension'ie jako inline SVG dla skalowania i kolor-control). Opcje:

- **Adobe Illustrator** "Image Trace" → "Outlines" → Export SVG.
- **[Vector Magic](https://vectormagic.com)** — online, dobry trace ale płatny.
- **Inkscape** (free) — `Path → Trace Bitmap → Brightness cutoff → Update`. Eksport SVG. Potem ręcznie wyczyść niepotrzebne path'y.
- **Najprostsze:** zamiast generować raster i trace'ować, dla 120×120 line-art **poproś Claude'a w VS Code'zie żeby narysował SVG ręcznie** — przy line-art geometrycznym to działa lepiej niż AI image gen. Prompt:
  ```
  Write three inline SVGs, each viewBox="0 0 120 120",
  stroke="currentColor" stroke-width="1.5" fill="none".
  1. Empty inbox: open tray + 2 floating leaves above
  2. All done: checkmark in rounded square + sparkles
  3. Empty queue: 3 dashed horizontal rectangles + magnifying glass
  Clean geometric style, minimal paths, optimized for inline HTML.
  ```

---

## 4. Bonus — header background pattern (opcjonalne)

Jeśli chcesz subtelny pattern w header'ze popup'a (np. siatka kropek nawiązująca do "network"):

**Midjourney v6:**
```
Subtle seamless tileable pattern, very faint navy blue #002A5C dots arranged on a 16px grid on white background, ultra-low opacity 5%, minimalist geometric, suitable as repeating background pattern for a SaaS dashboard header, no center subject, just texture, 1024x1024 --tile --v 6
```

Eksport jako `extension/icons/header-bg.png`, CSS:
```css
.header { background: var(--bg) url('icons/header-bg.png') repeat; }
```

**Skipowi to** jeśli wolisz czysto plain bg (rekomendowane dla minimal aesthetic — Linear/Stripe nie mają tła).

---

## 5. Workflow operacyjny (jak to faktycznie zrobić w 1h)

1. **Wybierz tool**: Midjourney ($10/mc na Basic, najlepsza jakość) ALBO ChatGPT Plus (masz GPT-image-1 w cenie) ALBO Flux Pro (przez fal.ai, pay-per-image ~$0.05/szt).
2. **Generuj wszystko**:
   - Icon: 3 warianty × 4 wersje każdy = 12 obrazów. ~10 min.
   - Empty states: 3 sceny × 4 wersje = 12 obrazów. ~10 min.
3. **Wybierz**: 1 icon final + 3 empty states. Postaw obok siebie w Figmie albo w PDF'cie. Wybór = 5 min.
4. **Skaluj icon** w Squoosh.app: 1024 → 128, 48, 16. Zapisz 3 pliki PNG do `extension/icons/`.
5. **SVG empty states**: poproś Claude'a w Code'zie żeby przerysował twoje wybrane PNG'i jako geometric SVG (sekcja 3 ostatni prompt). 10 min.
6. **Logo header**: prompt do Claude'a w Code'zie (sekcja 2). 5 min.
7. **Commit**: `feat: nowe asset'y graficzne (icons + empty states)`.

**Czas łączny:** ~50-60 min. Koszt: $0 (jeśli masz już subscription) albo ~$5 (jeśli pay-per-use Flux).

---

## 6. Negative prompts (Midjourney) — dla każdego asset'a dorzuć

Żeby nie generowało śmieci, dorzucaj na końcu każdego Midjourney prompt'a:

```
--no text, letters, logos, watermarks, signatures, gradients, shadows, 3D, photorealistic, faces, hands, people, complex details, clutter, busy composition
```

Dla DALL-E nie trzeba — instructional prompts działają w pozytywnej formie ("flat vector, no shading, no text").

---

## 7. Co zrobić jeśli żaden output nie satysfakcjonuje

1. **Zmień stylize value** (Midjourney `--stylize 30` → `--stylize 100`): wyższe = bardziej "artistic", niższe = bardziej dosłowne.
2. **Dorzuć referencje stylu** (Midjourney): `style of @linear, @stripe` lub URL do reference image (`--cref https://...`).
3. **Iteruj na jednym** zamiast generować od zera: jak masz blisko, użyj "Vary (Subtle)" w Midjourney albo "Variations" w ChatGPT.
4. **Fallback**: użyj gotowych asset'ów z [Lucide](https://lucide.dev) (logo), [unDraw](https://undraw.co) (empty states — można zmienić kolor primary online).

---

## TL;DR — minimalna ścieżka

Jeśli masz 30 min i chcesz mieć pełen brand set:

1. **Icon**: skopiuj **Wariant A** z sekcji 1 do Midjourney/ChatGPT. Wygeneruj 4-6. Wybierz. Skaluj.
2. **Logo header**: prompt z sekcji 2 do Claude'a w Code'zie. SVG inline.
3. **Empty states**: prompt-batch z sekcji 3 (ostatni — SVG od Claude'a) do Claude'a w Code'zie. Trzy SVG od razu.
4. **Skip** header pattern + ekstra polish — finalne 5% jakości daje 50% czasu.

Po tym masz `extension/icons/icon{16,48,128}.png` + inline SVG'i w `popup.html`/`dashboard.html`. Sprint #4 może ruszyć.
