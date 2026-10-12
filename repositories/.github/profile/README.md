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

**Jevelopers** is the neatHack 2026 team building **TicketStub**, a keepsake studio for the nights people want to remember. The product vision connects event research, editable artwork, exact ticket typography and a digital or printed keepsake.

> Keep the night: turn a ticket into a stub worth framing.

**Development status — 12 October 2026:** the studio preview and component implementations are on their owning repositories' default branches. Local tests and historical sponsor receipts cover specific slices; the [integrated release gate](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22) remains blocked. This page introduces the design and repository map. It does not certify an available physical product, a completed checkout or a passing end-to-end release.

[Explore the studio source](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) · [Download the public source collection](https://github.com/Jevelopers-neatHack-2026/Jevelopers-GetTicketStub.com-Submission) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) · [Contribute](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

<img src="./assets/perforation.svg" width="100%" alt="">

## Studio design

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/flow-night.svg">
  <img alt="Six steps: paste the link, watch it print, swipe styles, tilt the foil, tear to finish, pin to the wall." src="./assets/flow-day.svg" width="100%">
</picture>

The design starts with an event link or search, then offers research, style selection and tactile interactions. The illustration shows that intended journey. Research and creative outputs must retain source references, uncertainty and review boundaries; the [studio documentation](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/tree/main/docs/studio) and component READMEs explain the implemented paths and their remaining integration work.

## Five editions

The studio design includes five editions. These images are design references, and each edition has its own palette and type within the [stub system](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/studio/stub-system.md). They are not supplier samples or evidence of available print finishes.

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
      <b>Research informs the picture.</b> This Glasgow illustration shows how a confirmed fact, such as rain, can guide an art brief. It is an example, not a verified event record.<br><br>
      The imagery guidance calls for a text-free art layer, with event names and dates set separately by the composition system. Generated output still needs review; a prompt does not guarantee accuracy.<br><br>
      Rules: <a href="https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/main/docs/imagery.md">imagery.md</a>
    </td>
  </tr>
</table>

## Material and interaction references

<table>
  <tr>
    <td align="center" width="33%"><img src="./assets/finish-velvet-stamp.webp" alt="The Ts stamp in copper-to-cyan foil on dark velvet" width="250"><br><b>Foil reference</b>: a visual direction for light-responsive digital effects</td>
    <td align="center" width="33%"><img src="./assets/finish-holo.webp" alt="A holographic ticket catching a rainbow light leak" width="250"><br><b>Holo reference</b>: material inspiration, not an approved supplier option</td>
    <td align="center" width="33%"><img src="./assets/finish-stub-back.webp" alt="The back of a stub: handwritten setlist, friends, QR code and the Ts stamp in golden-hour light" width="250"><br><b>Back-of-stub concept</b>: notes, companions and a link to the memory</td>
  </tr>
</table>

The current brand sources describe paper and foil treatments, with app-versus-marketing direction still under [brand review](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/9). Browser support, reduced-motion behavior, audio settings and physical production capabilities belong to their implementation owners. Consult the [application README](https://github.com/Jevelopers-neatHack-2026/getticketstub.com#readme) for current pricing modes and checkout configuration; these reference images make no price, shipping or print-availability promise.

<img src="./assets/perforation.svg" width="100%" alt="">

## The repositories

The public directory below was checked on 12 October 2026. Repository READMEs are the entry points for setup and current limitations; a source repository's existence does not establish an accepted deployment or integration.

### Product and presentation

| Repository | Owns | Current scope |
|---|---|---|
| [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) | Customer studio, project and order authorization, application integration, architecture | Preview application and verification tooling; consult its runtime and provider configuration |
| [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit) | Master identity, logo sources, tokens and usage guidance | Source assets and local checks; identity and distribution approvals remain pending |
| [landing-page-repo](https://github.com/Jevelopers-neatHack-2026/landing-page-repo) | Product-page source and its reviewable deployment artifact | Static page and local validation; application adoption and deployment evidence are separate |
| [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material) | Messaging, collateral, demo narrative and claim provenance | Versioned internal drafts and review records; publication needs its own approval |
| [team-dashboard](https://github.com/Jevelopers-neatHack-2026/team-dashboard) | Typed admin Finance views and application-facing UI adapter | React module and synthetic conformance evidence; actual host acceptance remains separate |

### Runtime services

| Repository | Owns | Current scope |
|---|---|---|
| [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) | Durable workflows, decision ports, checkpoints, recovery and trace delivery | Local runtime and scoped provider evidence; host and full-workflow readiness tracked separately |
| [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence) | Event research, sourced facts, provenance and research cache | Bounded research implementation and local verification |
| [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine) | Creative briefs, generated artwork and immutable design revisions | Creative API and local validation; configured providers and consumer acceptance have separate gates |
| [print-production](https://github.com/Jevelopers-neatHack-2026/print-production) | Exact typography, composition, preflight and production artifacts | Local renderer and production API candidates; supplier and integrated release acceptance pending |
| [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors) | Provider quotes, submission identities and status observations | Connector and policy implementation; genuine provider authorization and evidence remain gated |
| [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) | Usage, prices, budgets, ledger, reconciliation and financial reporting | Local Finance implementation; source pins, hosted persistence and consumer evidence govern integration |

### Contracts, verification and shared guidance

| Repository | Owns | Current scope |
|---|---|---|
| [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts) | Cross-repository contract design and compatibility ownership | Offline receipt and proposal validators on `main`; the canonical package candidates remain unmerged |
| [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals) | Master acceptance checklist, evaluation runners and evidence index | Executable checks and scoped historical sponsor evidence; full release gate remains blocked |
| [.github](https://github.com/Jevelopers-neatHack-2026/.github) | This profile, contribution guidance and shared templates | Reduced governance-guidance scope accepted; repository settings and downstream adoption remain separate |

### Source collection

[Jevelopers-GetTicketStub.com-Submission](https://github.com/Jevelopers-neatHack-2026/Jevelopers-GetTicketStub.com-Submission) collects public default-branch source snapshots for convenient review. Its manifest records the exact source commits. Develop components in their owning repositories; the generated copies are a snapshot, not a new integrated build or a product acceptance receipt.

### How the pieces connect

The application owns the customer project and purchase authorization. The runtime repositories provide workflow execution, event facts, artwork, production files and provider observations; cost-intelligence owns the financial records, and team-dashboard presents authorized projections. Shared-contracts owns the interface design and compatibility handoffs, while integration-evals owns the acceptance decision.

Use the [canonical architecture guide](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md), [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md) and [implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md) for the detailed map. Proposed interfaces, private development archives and accepted releases are different states; each consumer records its own exact pin and verification.

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

TicketStub is our project for [neatHack 2026](https://neatlogs.com/hackathon). The [master acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) records qualified historical owner acceptance for the three sponsor criteria: Neatlogs traces, Entire checkpoints and the CFO.ai business plan. Each receipt retains its tested revision, original capture context and limitations.

Those sponsor receipts do not establish a fresh integrated product run, universal trace coverage, current deployment, generic Finance-export acceptance or a completed submission. The [evidence index](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/evidence/README.md) and [release gate](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22) carry those distinctions.

Want to help, or to review? Start with the [contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md) and the [acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

<img src="./assets/palette.svg" width="100%" alt="The TicketStub palette: Ticket Orange #E4572E, Copper #B4693E, Stage Moss #26302A, Holo Cyan #7CC6D2, Stub Cream #F4ECDD, Night Ink #17140F">

<p align="center">
  <img src="./assets/ts-stamp.svg" width="36" alt="Ts stamp"><br>
  Brand, editions and studio design by <a href="https://github.com/lmvdz">@lmvdz</a><br>
  Reference images are AI-generated explorations, with no vendor, artist or venue marks<br>
  Type: Fraunces and Inter Tight (SIL OFL 1.1)
</p>
