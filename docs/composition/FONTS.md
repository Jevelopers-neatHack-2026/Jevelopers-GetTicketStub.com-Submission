# Approved fixture font inventory

These are permitted **test font inputs**, not customer font approval. Production must inject its own current approved pinned inventory. No host/system font is redistributed.

| Fixture face | Source | Byte SHA-256 | License SHA-256 | Format |
| --- | --- | --- | --- | --- |
| `synthetic-latin`, NotoSans-Regular | [upstream static font at ffebf8c1ee449e544955a7e813c54f9b73848eac](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf) | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` | `0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb` | TTF |
| `synthetic-arabic`, NotoSansArabic-Regular | [Fontsource 5.3.0 archive](https://registry.npmjs.org/@fontsource/noto-sans-arabic/-/noto-sans-arabic-5.3.0.tgz), `files/noto-sans-arabic-arabic-400-normal.woff2` | `4e2ca0745c908761dc5c5db951662873887c59366fa1a5693ad22c0864abf1bd` | `91053c23e8a0fe5fc9b5fdbe5ff74ceffd66f6f996c123f1a6ca4c23487c1fff` | WOFF2 |
| `synthetic-latin-subset`, NotoSans-Regular | [existing Fontsource 5.3.0 archive](https://registry.npmjs.org/@fontsource/noto-sans/-/noto-sans-5.3.0.tgz), existing calibration asset retained byte-for-byte | `09aee8065d25508f23a4c3d92cd777ac869c52d93fd868a88f025d888a7937d6` | `54ec7b5a35310ad66f9f3091426f7028484cbf9ae1ab5da30122ee412a3009e1` | WOFF2 |

The new static TTF is 569208 bytes. Its unmodified [upstream OFL-1.1 license](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE) is retained as `src/assets/fonts/composition-noto-sans-OFL.txt`. Arabic package metadata attributes Copyright 2022 The Noto Project Authors, [notofonts/arabic](https://github.com/notofonts/arabic); its OFL is verified from the exact installed package. Fontsource's [font license description](https://fontsource.org/fonts/noto-sans-arabic/about) documents the OFL provenance.

All fonts are loaded by explicit fixture paths, independently hash checked and PostScript checked. The engine receives only pinned bytes and descriptor metadata; it has no path or network loader. Fallback order is separately approved by field/slot/repair policy. Current mechanical approval is checked again when repair chooses a fallback.

The existing Latin subset lacks U+030A. The static upstream face supplies that combining mark, enabling positive decomposed-ring evidence without changing source strings or weakening the glyph assertion. A variable upstream face was evaluated but not retained: this Chromium build produced Type 3 PDF fonts and mismatched measurement at ordinary rendering precision. Static font rendering with `text-rendering:geometricPrecision` passes the original independent measurement and embedded-font assertions. The tests do not certify arbitrary variable-font or script behavior.

Dependency additions are exact `@fontsource/noto-sans-arabic@5.3.0`, `sax@1.6.1`, and `@types/sax@1.2.7`. Lockfile integrity pins apply. SAX replaces an evaluated Saxes 6.0.0 dependency whose declarations failed strict TypeScript 6 checks; no compiler suppression was introduced.
