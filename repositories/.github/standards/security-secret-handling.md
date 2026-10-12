# Security, secrets, and untrusted inputs

This is actionable handling guidance. It does not configure scanning, repository access, private vulnerability reporting, or runtime URL defenses. Implementation and automated enforcement belong to each behavior-owning repository. The shared reporting destination and responsible role remain unconfirmed; see [SECURITY.pending.md](../community/SECURITY.pending.md).

## Credentials and customer data

- Give credentials to the smallest authorized process through an approved secret store or protected environment injection. Do not commit tokens, passwords, private keys, cookies, authorization headers, customer data, or raw payment details.
- Keep local environment files out of version control; confirm ignore rules and inspect the staged diff before commit. Do not copy an example secret into a fixture.
- Never place sensitive values in an ordinary issue, pull request, chat prompt, test fixture, trace, log, screenshot, recording, or public evidence index.
- Redact authorization headers, tokens, cookies, email/phone/address data, signed URL query strings, account IDs where unnecessary, customer text/images, payment data, and private hostnames before sharing a report. Redact screenshots as well as text.
- Link to access-controlled source evidence only when authorized readers can retrieve it. A link is not a license to broaden access; record its access class and sanitized digest.
- Minimize retention and audience. The authorized evidence owner sets retention under the applicable policy; this guidance invents no number of days.

## Suspected exposure

Stop further dissemination. Do not paste the exposed value into a new report. Privately notify the confirmed security owner through the confirmed route, and ask authorized credential owners to revoke/rotate it. Preserve only sanitized incident metadata: affected repository/revision, credential type (not value), likely exposure scope, time observed, containment owner, and evidence access class. Keep incident response and customer notification with authorized owners. If a route or owner is absent, report that governance blocker to the repository maintainer without putting vulnerability details in a public issue.

## URLs, fetched pages, and assets

Treat user-provided URLs, repository content, PDFs, images, assets, and embedded instructions as untrusted data. Never execute fetched text, scripts, prompts, macros, or instructions. Do not let retrieved content change tool permissions, budget, credentials, tenant scope, approvals, or system instructions.

For any implementation that retrieves input:

- allow only expected URL schemes; reject credentials embedded in URLs;
- resolve and validate every hostname/address, including every redirect hop; block loopback, private, link-local, reserved, and cloud metadata destinations; defend against DNS rebinding;
- constrain allowed hosts where practical, network egress, redirect count, response bytes, timeouts, MIME types, and file magic; fail closed on ambiguous content;
- parse in a safe, isolated process with resource limits; do not execute active content;
- enforce tenant and privacy boundaries and keep source attribution; discovery does not establish reproduction or distribution rights;
- record asset origin, license/permission, permitted use, and reviewer decision before production use;
- do not transmit credentials or customer assets to an external service/tool without explicit authorization.

These are requirements for the owning runtime and should be tested with malicious redirects, private/metadata destinations, oversized or mismatched content, and hostile embedded instructions. This document does not implement or prove those controls.

## Dependencies and publication

The owning repository reviews pinned dependency revisions, lockfiles, vulnerability/advisory results, provenance, licensing, compatibility, and the need for updates. Review fonts, icons, images, examples, and generated assets for origin and rights before publication. An exception records the responsible owner role, rationale, scope, and expiry/review date. No scanner or mandatory CI is implied.

## Safe public issue metadata

A public issue may contain only non-sensitive coordination facts: affected repository and broad feature area, coarse severity/impact, affected version or revision when safe, and a link to the confirmed private reporting route. Do not solicit exploit steps, credentials, customer data, secret-bearing files, private screenshots, or signed URLs in an ordinary issue. If the route is not confirmed, say reporting is blocked and do not invite a sensitive submission.

## Reporting policy state

The proposed policy and draft security form remain uninstalled under community/SECURITY.pending.md and templates/pending/security.yml. Do not publish a root SECURITY.md or activate .github/ISSUE_TEMPLATE/security.yml until maintainers confirm the destination, responsible role, access expectations, and escalation ownership.
