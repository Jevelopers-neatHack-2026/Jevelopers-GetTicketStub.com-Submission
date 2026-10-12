# Entire session capture

Shared session checkpoint publishing is disabled in settings.json. The configured checkpoint repository is only a destination hint; it is not proof that every clone, fork, local CLI version, or configured push URL will use that destination.

Keep push_sessions disabled by default. A developer may opt in locally only after verifying the installed CLI version, every configured origin and push URL, destination ownership and visibility, collaborator access, and the transcript redaction and retention behavior. Do not enable it for public forks or when any destination is uncertain.

Graph generation in the repository workflow is also disabled until the plugin source, compatible release, immutable digest, and generated-file contract receive independent review. The local agent-instruction fallback does not install the CLI or upload repository content.
