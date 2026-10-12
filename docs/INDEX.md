# Documentation index

This map routes engineers to the maintained API, gates, local evidence and boundaries. The package is private and unpublished; mock/offline checks are not live-provider access or acceptance.

## Development and API
- [Development and checks](development.md) lists the toolchain and offline test commands.
- [Creative API](api/creative-api.md) describes operations, injected ports, validation and unavailable responses.
- [Creative brief](creative-brief.md), [concept generation](creative/concept-generation.md), [evaluation](evaluation/creative-evaluation.md), and [rubric](evaluation/creative-rubric.md) describe local planning and evidence.

## Providers, usage and versions
- [OpenAI Images](providers/openai-images.md) and [OpenRouter Images](providers/openrouter-images.md) describe adapter boundaries.
- [Provider-access preparation](operations/provider-access.md) and [execution-target preparation](operations/execution-target-preparation.md) are gated preparation documents; follow their owner decisions before any provider configuration or call.
- [Usage trace evidence](usage-trace-evidence.md) explains local attempt and usage records.
- [Version state machine](creative/version-state-machine.md) documents immutable versions and transitions.

## Controls and handoff
- [Controls integration](controls-integration.md), [controls package integration](controls-package-integration.md), [actual inspection](controls/actual-inspection.md), and [inspection consumer preparation](controls/inspection-consumer-preparation.md) cover local controls and consumer boundaries.
- [Creative boundary](contracts/creative-boundary.md), [approval handoff](contracts/approval-handoff.md), [DecisionPort](contracts/decision-port.md), and [metering](contracts/metering.md) identify proposals and owner handoffs.
- See [ownership](architecture/OWNERSHIP.md) and [acceptance allocation](architecture/ACCEPTANCE.md).
