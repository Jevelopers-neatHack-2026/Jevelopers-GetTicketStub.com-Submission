# Ticketstub – neatHack Agent Brief (for DeepSeek)

**Role**: You are a senior pair-programmer. We have ~48 hours for neatHack (“Build agents you’d trust to run without you watching”). Optimize strictly for the judging rubric. Prefer complete, runnable files. State assumptions in one line and keep building. Do not invent SDK APIs. If unsure about neatlogs / Entire / cfo.ai, say so.

## Goal
Ship one agent that finishes a real task end-to-end, checks its own work, recovers from a failure, and leaves evidence of improvement.

## Judging Rubric (build only to these weights)
| Category                          | Weight | Must be visible                                      |
|-----------------------------------|--------|------------------------------------------------------|
| The agent                         | 30%    | Real task completed, state, tool calls, verification, failure recovery |
| neatlogs + Entire + cfo.ai        | 25%    | Meaningful use of all three                          |
| Demo video                        | 20%    | Clearly explains agent + all three tools             |
| Building in public                | 15%    | Verifiable public updates tagged #neatHack           |
| Usefulness and originality        | 10%    | Real problem solved distinctively                    |

Agent + required tools + demo = 75% of the score.

## Product (one narrow slice only)
**Ticketstub** turns an event memory into a personalized, production-ready commemorative ticket print.

### Agent Workflow
1. Input: ticket image, optional personal photo, short memory text
2. Extract event details (artist/event, venue, date, seat…). Flag missing/low-confidence fields
3. Resolve uncertainty (ask user or mark unverified)
4. Pick layout from user preferences
5. Generate artifact (template-driven SVG → PDF)
6. Run deterministic production checks (resolution, bleed, safe margins, text overflow, fonts)
7. If a check fails → revise strategy, regenerate, revalidate (hard retry limit = 3)
8. Compute estimated cost & margin in code
9. Show preview, downloadable PDF, and execution report
10. Require explicit user approval before any paid/fulfillment action. Never auto-purchase.

### Planned Failure Scenario (demo centerpiece)
Inject a low-resolution personal photo that fails the print spec.
- Baseline agent: detects failure and stops or produces bad result
- Improved agent: detects it, logs why, switches to a layout that does not upscale that image, regenerates, revalidates, and preserves event details + user preference
- Real traces only. Do not fake the failure or the recovery.

## Stack (use what already works)
- App: Next.js + TypeScript + Tailwind
- Agent runtime: TypeScript state machine with typed tool calls, persisted state, bounded retries, resumable runs
- Model: one tool-capable model you have keys for
- Validation: Zod + deterministic code checks
- Storage: existing DB/object storage or Supabase
- Artifact: template SVG → PDF
- Observability: neatlogs (required)
- Dev evidence: Entire (required)
- Business plan: cfo.ai (required)

Principles:
- Model makes interpretive decisions. Code does arithmetic and acceptance checks.
- One explainable agent.
- Every step logged and inspectable.

### Persisted RunState (exact shape)
```ts
type RunState = {
  run_id: string;
  current_step: string;
  event_details: Record<string, unknown>;
  uncertainties: string[];
  user_preferences: Record<string, unknown>;
  artifact_versions: { version: number; path: string; layout: string }[];
  validation_results: { check: string; passed: boolean; detail: string }[];
  retry_count: number;
  estimated_cost: { model: number; production: number; total: number; currency: string };
  approval_status: "pending" | "approved" | "rejected";
};