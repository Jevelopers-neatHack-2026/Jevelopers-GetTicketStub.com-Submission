# Imagery

Reference images are in `references/` (curated WebP).

## Photography and renders (marketing, store, packaging)

- **Day: paper on a desk.** Low, warm, raking window light with hard shadows. Cream and kraft surfaces. See `references/mood-stub-back-golden-hour.webp`.
- **Night: object on velvet.** Near-black ground, with copper-to-cyan light leaks crossing the object. See `references/ts-stamp-holo-rainbow.webp` and `references/mood-holo-light.webp`.
- **The stub is always the hero.** Hands are fine. Faces, crowds and stages are not, because the memory belongs to the user, not to us.

## Generated stub art (the Researched edition and remixes)

These rules come from the Glasgow test series and are mandatory for every generated art layer.

1. **No text in the art, ever.** The type engine sets every letter. Add `--no text, letters, typography` (or the model's equivalent) to every prompt.
2. **One orange accent.** Every scene is muted except one Ticket Orange element: an umbrella, scarf, sign or neon. This keeps all generated stubs related to each other and to the brand.
3. **Research facts become constraints.** Weather, season, time of day and venue architecture go into the prompt, and the opposites go into the negative prompt. If the stub says "rain", the art cannot show snow.
4. **Leave room for type.** Keep an empty area matched to the stub shape: the top third for portrait stubs, a side column for a sideways fact line.
5. **Describe, don't copy.** Tour eras, palettes and moods are fine. Real logos, album covers, trademarks and likenesses are not.

### Prompt template

```
Illustration only, no text, no letters: {weather} {time of day} in {city}, {venue architecture},
{light sources}, lone figure with {orange accent object}, {palette from research},
painterly vintage travel-poster style, vertical composition with empty dark sky in the top third
--ar 2:3 --no text, letters, typography{, weather opposites}
```

## Never

- Ticketmaster or any vendor marks. Some of the classic thermal references carry them; those are internal only.
- Official artist or venue logos, unless an organizer deal licenses them (B2B only).
- Stock "concert crowd with hands up" photography.
