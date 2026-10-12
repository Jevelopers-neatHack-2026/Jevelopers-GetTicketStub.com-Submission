<a href="https://github.com/Jevelopers-neatHack-2026/getticketstub.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/banner-night.svg">
    <img alt="TicketStub by Jevelopers. Keep the night: the keepsake studio that turns any ticket into a stub worth framing." src="./assets/banner-day.svg" width="100%">
  </picture>
</a>

<p align="center">
  <a href="https://github.com/Jevelopers-neatHack-2026/getticketstub.com"><img alt="Studio" src="https://img.shields.io/badge/studio-getticketstub.com-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="https://github.com/Jevelopers-neatHack-2026/brand-kit"><img alt="Brand kit" src="https://img.shields.io/badge/brand-kit-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md"><img alt="Architecture" src="https://img.shields.io/badge/architecture-kit%20v1.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="https://neatlogs.com/hackathon"><img alt="neatHack 2026" src="https://img.shields.io/badge/neatHack-2026-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

**Jevelopers** is the neatHack 2026 team building **TicketStub**: paste the link to a show, a game or a night out, and get back a collectible stub with the facts of that night set in type, art made for it, and foil that catches the light. Then tear it off, pin it to your wall, or print it and frame it.

> For people who want to keep the night, TicketStub is the keepsake studio that turns any ticket into a stub worth framing. No forms: drop your ticket and it's done.

<img src="./assets/perforation.svg" width="100%" alt="">

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/flow-night.svg">
  <img alt="Six steps: paste the link, watch it print, swipe styles, tilt the foil, tear to finish, pin to the wall." src="./assets/flow-day.svg" width="100%">
</picture>

The only thing you ever type is a link or a search. A research agent digs up the night while the stub prints (the weather, which night of the tour, who opened) and every fact shows where it came from. Everything after that is tap, swipe, tilt and tear.

## Five editions

Every stub can be dealt in five styles. The editions are the user's artwork, so each has its own palette and type; only the Ts stamp and the foil come from our brand.

<table>
  <tr>
    <td align="center" width="20%"><img src="./assets/edition-classic.webp" alt="Classic edition: thermal box-office stub" width="150"><br><b>Classic</b><br>thermal box office</td>
    <td align="center" width="20%"><img src="./assets/edition-letterpress.webp" alt="Letterpress edition: two-colour poster type on cream stock" width="150"><br><b>Letterpress</b><br>inked and pressed</td>
    <td align="center" width="20%"><img src="./assets/edition-risograph.webp" alt="Risograph edition: two-ink overprint" width="150"><br><b>Risograph</b><br>two inks, overprinted</td>
    <td align="center" width="20%"><img src="./assets/edition-minimal.webp" alt="Minimal edition: one big date numeral" width="150"><br><b>Minimal</b><br>one number, lots of air</td>
    <td align="center" width="20%"><img src="./assets/edition-researched.webp" alt="Researched edition: generated art of a rainy Glasgow night" width="150"><br><b>Researched</b><br>art made from the facts</td>
  </tr>
</table>

<table>
  <tr>
    <td width="34%"><img src="./assets/art-layer-glasgow.webp" alt="A text-free art layer: a lone figure with an orange umbrella outside a lit concert hall in the rain" width="280"></td>
    <td>
      <b>Research becomes the picture.</b> If it rained in Glasgow on night 2 of 3, the art shows rain in Glasgow, and the negative prompt rules out snow.<br><br>
      The art never contains text: our type engine sets every letter, so names and dates are always exact. Every scene is muted except for one orange accent, which keeps every generated stub related to the others.<br><br>
      Rules: <a href="https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/main/docs/imagery.md">imagery.md</a>
    </td>
  </tr>
</table>

## Made to be handled

<table>
  <tr>
    <td align="center" width="33%"><img src="./assets/finish-velvet-stamp.webp" alt="The Ts stamp in copper-to-cyan foil on dark velvet" width="250"><br><b>Foil</b> that follows the light: gyro on phones, hover on desktop</td>
    <td align="center" width="33%"><img src="./assets/finish-holo.webp" alt="A holographic ticket catching a rainbow light leak" width="250"><br><b>Holo stock</b> and spot holo as print upgrades</td>
    <td align="center" width="33%"><img src="./assets/finish-stub-back.webp" alt="The back of a stub: handwritten setlist, friends, QR code and the Ts stamp in golden-hour light" width="250"><br><b>The back</b>: setlist or score, a note, who you were with, a QR to the memory page</td>
  </tr>
</table>

Paper by day, foil by night. Sound is on by default (with a mute toggle you can always see), haptics mark every tear, and the foil is eased frame by frame so it never pops in. Digital $9 · Card $29 · Print $49 · Framed $89, all sandbox prices for the hackathon.

<img src="./assets/perforation.svg" width="100%" alt="">

## The repositories

Fourteen repositories, each with one job. Status reflects what is on `main` on 11 October 2026, not what is planned.

| | Repository | Job | Status |
|:-:|---|---|---|
| 🎟️ | [**getticketstub.com**](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) | The studio app, wall, memory pages and checkout; architecture kit | [![Status: studio preview on main](https://img.shields.io/badge/studio-preview%20on%20main-E4572E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) |
| 🎨 | [**brand-kit**](https://github.com/Jevelopers-neatHack-2026/brand-kit) | Logo system, tokens, voice, motion, foil rules | [![Status: core identity on main, not ratified or versioned](https://img.shields.io/badge/status-unversioned%20source-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/brand-kit) |
| 🧭 | [**agent-harness**](https://github.com/Jevelopers-neatHack-2026/agent-harness) | Durable agent workflows, checkpoints and recovery | [![Status: experimental local foundation](https://img.shields.io/badge/status-experimental%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/agent-harness/blob/main/docs/decisions/runtime-foundation.md) |
| 🔎 | [**event-intelligence**](https://github.com/Jevelopers-neatHack-2026/event-intelligence) | Sourced event facts, provenance and research cache | [![Status: local foundation](https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/event-intelligence) |
| 🖌️ | [**creative-engine**](https://github.com/Jevelopers-neatHack-2026/creative-engine) | Creative briefs, artwork versions and revisions | [![Status: local foundation](https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/creative-engine) |
| 📐 | [**shared-contracts**](https://github.com/Jevelopers-neatHack-2026/shared-contracts) | Public schemas, validators and compatibility fixtures | [![Status: docs baseline](https://img.shields.io/badge/status-docs%20baseline-7a756c?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md) |
| 🖨️ | [**print-production**](https://github.com/Jevelopers-neatHack-2026/print-production) | Exact type, templates and print-ready files | [![Status: local foundation](https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/print-production/blob/main/docs/runtime/README.md) |
| 📦 | [**fulfillment-connectors**](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors) | Supplier quotes, orders and status | [![Status: local foundation](https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/blob/main/docs/runtime.md) |
| 💰 | [**cost-intelligence**](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) | Pricing, metering, budgets, ledger and finance exports | [![Status: local foundation](https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/blob/main/docs/api/README.md) |
| 📊 | [**team-dashboard**](https://github.com/Jevelopers-neatHack-2026/team-dashboard) | The finance admin module inside the studio | [![Status: local foundation](https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/team-dashboard/blob/main/docs/integration/TD-01-coverage.md) |
| ✅ | [**integration-evals**](https://github.com/Jevelopers-neatHack-2026/integration-evals) | End-to-end checks, acceptance checklist and evidence | [![Status: docs baseline](https://img.shields.io/badge/status-docs%20baseline-7a756c?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) |
| 🪧 | [**landing-page-repo**](https://github.com/Jevelopers-neatHack-2026/landing-page-repo) | The public product page | [![Status: docs baseline](https://img.shields.io/badge/status-docs%20baseline-7a756c?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/landing-page-repo) |
| 📣 | [**marketing-material**](https://github.com/Jevelopers-neatHack-2026/marketing-material) | Demo narrative, launch copy and claim provenance | [![Status: synthetic drafts, publication not approved](https://img.shields.io/badge/drafts-not%20approved%20to%20publish-7CC6D2?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/marketing-material/blob/main/review/releases/v0.1.0-rehearsal.md) |
| 🧰 | [**.github**](https://github.com/Jevelopers-neatHack-2026/.github) | This page, contribution guidance and shared standards | [![Status: guidance on main, partly published](https://img.shields.io/badge/guidance-partly%20published-26302A?style=flat-square)](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/docs/status.md) |

**Local foundation:** built and tested inside its own repository; integration with the other pieces and acceptance are still open. **Docs baseline:** plans and ownership only on `main` (shared-contracts and integration-evals have implementation work in draft pull requests). **Drafts:** a synthetic rehearsal and collateral, not approved for publication. The studio preview is a hackathon prototype, with more work in review.

<details>
<summary><b>How the pieces connect</b></summary>
<br>

```mermaid
flowchart LR
  U([Fan or organizer]) --> S[getticketstub.com<br/>studio]
  S --> H[agent-harness]
  H --> E[event-intelligence<br/>facts + sources]
  H --> C[creative-engine<br/>text-free art]
  C --> P[print-production<br/>exact type + print files]
  E --> P
  P --> F[fulfillment-connectors<br/>quotes + orders]
  H -. usage .-> CI[cost-intelligence]
  F -. costs .-> CI
  CI --> D[team-dashboard]
  K[(shared-contracts)] -.- S & H & E & C & P & F & CI
  I{{integration-evals}} -.- K
```

Every arrow crosses a contract defined in [`shared-contracts`](https://github.com/Jevelopers-neatHack-2026/shared-contracts). The full picture is in the [architecture guide](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) and the [implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md).

</details>

<img src="./assets/perforation.svg" width="100%" alt="">

## Team

<table>
  <tr>
    <td align="center" width="25%"><a href="https://github.com/CompleteDotTech"><img src="https://github.com/CompleteDotTech.png?size=160" width="80" alt=""><br><b>Timothy Wayne Gregg</b></a><br>@CompleteDotTech</td>
    <td align="center" width="25%"><a href="https://github.com/lmvdz"><img src="https://github.com/lmvdz.png?size=160" width="80" alt=""><br><b>Lars van der Zande</b></a><br>@lmvdz</td>
    <td align="center" width="25%"><a href="https://github.com/zwright8"><img src="https://github.com/zwright8.png?size=160" width="80" alt=""><br><b>Zachary Wright</b></a><br>@zwright8</td>
    <td align="center" width="25%"><a href="https://github.com/lajefahemp-collab"><img src="https://github.com/lajefahemp-collab.png?size=160" width="80" alt=""><br><b>@lajefahemp-collab</b></a><br>&nbsp;</td>
  </tr>
</table>

## Built for neatHack 2026

TicketStub is our entry for [neatHack 2026](https://neatlogs.com/hackathon). The rules ask for a substantial agent task, public code with event-dated commits, and real use of three sponsor tools: **Neatlogs** for agent traces, **Entire** for checkpoints, and **CFO.ai** for the business plan. None of those integrations is accepted yet. `agent-harness` maps its trace records through the Neatlogs SDK locally, but no trace has reached Neatlogs; a CFO.ai business plan is in review in [integration-evals #24](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/24). We'll record each one in [`integration-evals`](https://github.com/Jevelopers-neatHack-2026/integration-evals) as the evidence comes in.

Want to help, or to review? Start with the [contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md) and the [acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

<img src="./assets/palette.svg" width="100%" alt="The TicketStub palette: Ticket Orange #E4572E, Copper #B4693E, Stage Moss #26302A, Holo Cyan #7CC6D2, Stub Cream #F4ECDD, Night Ink #17140F">

<p align="center">
  <img src="./assets/ts-stamp.svg" width="36" alt="Ts stamp"><br>
  Brand, editions and studio design by <a href="https://github.com/lmvdz">@lmvdz</a><br>
  Reference images are AI-generated explorations, with no vendor, artist or venue marks<br>
  Type: Fraunces and Inter Tight (SIL OFL 1.1)
</p>
