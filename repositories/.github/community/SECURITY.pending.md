# Proposed security reporting policy — pending maintainer decision

**Status: blocked.** The private reporting destination, responsible owner role, access expectations, and escalation owner have not been confirmed. This file is a review draft and is not a working report route. Do not publish it as SECURITY.md or use it to solicit vulnerability details.

## Proposed policy after confirmation

Contributors should not post credentials, customer data, exploit details, secret-bearing attachments, or sensitive logs in ordinary issues, pull requests, or public evidence. Sensitive vulnerability details should go only to a maintainer-confirmed private destination with access limited to the responsible security owner and authorized responders. Public issue metadata should contain only the affected repository, broad area, safe version/revision, coarse impact, and a link to that confirmed route.

The responsible owner would acknowledge and coordinate investigation, containment, and escalation. Credential revocation/rotation belongs to the authorized credential owner. No response-time commitment is proposed here.

## Required decisions before installation

- Confirm the private reporting destination and test its access with a harmless message.
- Confirm the responsible role and backup/escalation owner.
- Confirm who may access reports, how evidence is stored, and the applicable retention policy.
- Confirm repository-specific GitHub private vulnerability reporting availability/settings; do not infer support from this document.
- Review the safe public metadata form and the security issue-form draft.
- Copy an approved policy to SECURITY.md in each destination repository and place the form at .github/ISSUE_TEMPLATE/security.yml only after the route works there.
- Record the decision owner, date, verification evidence, and affected repository revision.

The current plan defers GH-07 reporting and GH-03-I security-form routing; both issues are closed not
planned, not completed or verified. If maintainers reopen either requirement, it remains blocked until
the route and owners are confirmed and the safe walkthrough is complete. No private route is currently
confirmed, so sensitive details must not be sent through a public issue.
