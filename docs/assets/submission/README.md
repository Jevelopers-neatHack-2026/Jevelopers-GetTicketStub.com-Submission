# Submission visual sources

These assets use TicketStub's cream, ink, orange, moss, copper, and cyan palette. Diagram text uses Inter Tight with a sans-serif fallback; headings use Fraunces with a serif fallback. The [existing brand specification](../../../repositories/brand-kit/SPEC.md) remains the source of the design direction.

| Asset | Source and meaning |
| --- | --- |
| banner.jpg | New AI concept illustration of a keepsake. Not a product photo or proof of a printed order. |
| journey-art.jpg / journey.svg | New AI illustrations with editable SVG layout and exact labels. The local demo uses sample facts and art. |
| system.svg / system-dark.svg | Editable source-structure diagram. Does not claim full integration of the 14 projects. |
| tools.svg / tools-dark.svg | Editable diagram of the documented sponsor roles. Scope is explained in the evidence guide. |
| studio-demo-desktop.jpg / studio-demo-mobile.jpg / studio-demo-wall.jpg | Unretouched Chrome screenshot of studio commit 6daafba1, captured locally in demo mode on October 12, 2026. |
| sample-stub-download.png | Actual PNG downloaded from that local demo. Fictional concert and sample art. Original output retained without recompression. |
| entire-official.svg / cfo-official.svg | Unchanged sponsor marks served by the official event website. No generated replacement marks. neatlogs is shown as plain text. |

The [original video kit](ticketstub_judges_cut_video_kit.zip) was supplied by the team on October 12. Its extracted [MP4](ticketstub_judges_cut_animatic.mp4) is a silent schematic storyboard, not filmed product evidence. `ffprobe` measured 170.04 seconds, 1280 × 720 pixels, and no audio stream. The source ZIP and extracted files passed a Gitleaks scan. The timeline was visually inspected. The original ZIP is unchanged; its production notes do not override the verified official rules.

The [2:34 p.m. prior usage PDF](timothy-wayne-gregg-token-usage-2026-10-12-143507.pdf) was supplied and attributed to Timothy Wayne Gregg (`completedottech`) on October 12. It is an unchanged copy of `jevelopers-neathack-2026-20261012-143507-designed-report.pdf`, through 2:34:36 p.m. Eastern. The [earlier PDF](timothy-wayne-gregg-token-usage-2026-10-12.pdf), from `jevelopers-neathack-2026-20261012-135232-designed-report.pdf`, remains as a prior snapshot. Both were renamed for clear attribution. They cover his local coding-agent usage, with API-price estimates rather than bills. [Scope and evidence limits](../../judges/USAGE.md) accompany the reports; their team-branded titles do not establish team-wide totals. Never add these overlapping snapshots together.

Official sponsor asset sources, checked October 12: [Entire](https://neatlogs.com/hackathon/sponsors/entire.svg), [cfo.ai](https://neatlogs.com/hackathon/sponsors/cfo.svg). Their presence on the event page establishes the source, not a separate brand-license grant or sponsor approval of this submission.

The [searchable usage HTML](timothy-wayne-gregg-usage-2026-10-12-143507.html) and [complete ZIP](timothy-wayne-gregg-usage-2026-10-12-143507.zip) are unchanged copies supplied for Timothy's same `143507` snapshot. The originals were `exhaustive/report.html` and `exhaustive-report.zip`. Download and extract the ZIP to keep the HTML's CSV links working; GitHub does not render uploaded HTML as a live page. All 50 bundled checksums passed, and all extracted files passed the secret scan. [Validation and scope](../../judges/USAGE.md#file-integrity) distinguish agreement within the exported data from an audit of original logs or charges.

The [Crystal Codex usage PDF](crystal-lajefa-usage-2026-10-12.pdf) is an unchanged copy of `NeatHack2026-Jevelopers-usage-report (1).pdf`, supplied on October 12. The team corrected its attribution from Zach to Crystal (`lajefa`). It covers a reported October 10–12 Codex log selection. [Scope and evidence limits](../../judges/CRYSTAL-CODEX-USAGE.md) explain the estimated prices, missing underlying data, and team-supplied identity. Its checksum is in the asset manifest.

The **latest 5:35 p.m. snapshot** is retained unchanged as [PDF](timothy-wayne-gregg-token-usage-2026-10-12-173441.pdf), [searchable HTML](timothy-wayne-gregg-usage-2026-10-12-173441.html), and [complete ZIP](timothy-wayne-gregg-usage-2026-10-12-173441.zip). Its source identifier is `jevelopers-neathack-2026-20261012-173441`; the exact cutoff is 5:35:05 p.m. Eastern. The earlier `143507` bundle above remains a prior snapshot. All 50 latest bundled hashes and all 34 aggregate tables reconcile. The PDF and HTML agree byte-for-byte with their bundled versions. [Current totals and limits](../../judges/USAGE.md) remain separate from actual charges.

## Image generation record

Generated October 12, 2026 through the built-in `image_gen.imagegen` tool. The official OpenAI model page identifies [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) as the current target. The tool has no model selector and returned no model name. **The actual backend version is unverified.** We requested the latest model but do not label these images as proven GPT Image 2.5 output. No paid API fallback was used.

Exact prompts: [banner](banner-prompt.txt) and [journey](journey-prompt.txt). Both requested no text or logos. Each returned image was visually inspected for unwanted text, visual defects, color, and consistency. The originals remain in the creator's generated-image store; optimized JPEGs are the repository's maintained artwork. `sips` converted the banner at JPEG quality 82 and the journey at quality 80. No product screenshot was synthesized.

Rebuild the diagrams from the repository root:

```sh
python3 scripts/build_submission_visuals.py
```

The generator embeds the local raster artwork and official marks so the SVGs do not fetch remote assets. Light and dark system/tool variants have explicit backgrounds. Journey art stays on cream paper in both themes. Important labels and caveats also appear as ordinary Markdown text.

[File sizes and hashes](ASSET-MANIFEST.json) record the delivered inputs and outputs. See [validation](../../judges/VALIDATION.md) for rendering checks.
