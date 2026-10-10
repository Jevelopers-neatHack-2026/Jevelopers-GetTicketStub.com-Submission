import unittest
from datetime import datetime, timedelta, timezone

from src.privacy.boundary import (
    ContentBoundary,
    ContentModality,
    BoundaryResult,
    EvidenceProvenance,
    FieldAdmissionError,
    PrivateEvidenceUnavailable,
    PrivateOriginalRef,
    PrivateOriginalVault,
    QuarantineCode,
    RetentionPolicy,
    SessionState,
    SourceDocument,
    TrustedTenantContext,
    admit_public_fields,
    safe_diagnostics,
    SessionState,
)


class ContentBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.context = TrustedTenantContext("tenant-alpha")
        self.vault = PrivateOriginalVault(RetentionPolicy(ttl_seconds=300, allow_private_review=True))
        self.boundary = ContentBoundary(self.vault)

    def ready(self, modality, payload, fields, external_reference="browser-tenant-omega"):
        session = self.boundary.begin(
            self.context,
            SourceDocument(modality, payload, external_reference=external_reference),
        )
        self.assertIs(session.prepare(fields), SessionState.REDACTED)
        return session.publish()

    def test_text_modalities_are_tagged_as_untrusted_and_allow_safe_facts(self):
        cases = (
            (ContentModality.HTML, "<h1>Night Lights</h1><time>2027-08-12</time><div>Main Hall</div>"),
            (ContentModality.OCR_TEXT, "Night Lights | 2027-08-12 | Main Hall"),
            (ContentModality.PDF_TEXT, "Night Lights | 2027-08-12 | Main Hall"),
            (ContentModality.PDF_METADATA, "Night Lights | 2027-08-12 | Main Hall"),
            (ContentModality.PLAIN_TEXT, "Night Lights | 2027-08-12 | Main Hall"),
        )
        for modality, payload in cases:
            with self.subTest(modality=modality.value):
                result = self.ready(
                    modality,
                    payload,
                    {"event_name": "Night Lights", "event_date": "2027-08-12", "venue": "Main Hall"},
                )
                self.assertIs(result.state, SessionState.PUBLISHED)
                self.assertEqual(result.derivative.facts.event_name, "Night Lights")
                self.assertEqual(result.derivative.provenance.trust.value, "untrusted_external")
                self.assertEqual(result.derivative.provenance.modality, modality.value)

    def test_html_hidden_content_cannot_support_a_field(self):
        session = self.boundary.begin(
            self.context,
            SourceDocument(ContentModality.HTML, "<script>Hidden Event</script><h1>Visible Event</h1>"),
        )
        state = session.prepare({"event_name": "Hidden Event"})
        self.assertIs(state, SessionState.QUARANTINED)
        self.assertIs(session.result().quarantine_code, QuarantineCode.INVALID_FIELDS)
        self.assertIsNone(session.publish().derivative)

    def test_binary_and_attendee_csv_are_quarantined_before_handoff(self):
        cases = (
            (ContentModality.IMAGE_BINARY, b"\x89PNG\r\nopaque-private-qr"),
            (ContentModality.PDF_BINARY, b"%PDF-opaque-scanned-document"),
            (ContentModality.ATTENDEE_CSV, "name,email,seat\nPrivate Person,private@example.invalid,A-14"),
            (ContentModality.UNKNOWN_BINARY, b"unknown bytes"),
        )
        for modality, payload in cases:
            with self.subTest(modality=modality.value):
                session = self.boundary.begin(self.context, SourceDocument(modality, payload))
                state = session.prepare({"event_name": "Night Lights"})
                self.assertIs(state, SessionState.QUARANTINED)
                self.assertIsNone(session.publish().derivative)
                self.assertIn(
                    session.result().quarantine_code,
                    (QuarantineCode.OPAQUE_BINARY, QuarantineCode.ATTENDEE_DATA),
                )

    def test_malformed_text_is_quarantined(self):
        session = self.boundary.begin(
            self.context,
            SourceDocument(ContentModality.PDF_TEXT, b"\xff\xfe\xfa"),
        )
        self.assertIs(session.prepare({"event_name": "Night Lights"}), SessionState.QUARANTINED)
        self.assertIs(session.result().quarantine_code, QuarantineCode.INVALID_UTF8)

    def test_allowlisted_fields_are_strictly_typed_and_date_is_canonical(self):
        cases = (
            {"event_name": "Night Lights", "approval": "approved"},
            {"event_name": ["Night Lights"]},
            {"event_name": "Night Lights", "event_date": "08/12/2027"},
            {"event_name": True},
            [],
        )
        for candidate in cases:
            with self.subTest(candidate=repr(candidate)):
                with self.assertRaises(FieldAdmissionError) as raised:
                    admit_public_fields(candidate)
                self.assertEqual(str(raised.exception), "invalid or unapproved fields")

    def test_personal_and_access_values_are_redacted_while_event_facts_survive(self):
        raw = (
            "Night Lights; attendee name: PersonCanary, email: namecanary@example.invalid; "
            "2027-08-12; Main Hall; seat: A-14; ticket code: TKT-CANARY-42; "
            "phone: +1 212-555-0191; https://tickets.example/e?access_token=URL-CANARY-42"
        )
        fields = {
            "event_name": "Night Lights; attendee name: PersonCanary, email: namecanary@example.invalid",
            "event_date": "2027-08-12",
            "venue": (
                "Main Hall; seat: A-14; ticket code: TKT-CANARY-42; phone: +1 212-555-0191; "
                "https://tickets.example/e?access_token=URL-CANARY-42"
            ),
        }
        result = self.ready(ContentModality.OCR_TEXT, raw, fields)
        self.assertIs(result.state, SessionState.PUBLISHED)
        rendered = repr(result.derivative.facts.as_dict())
        for canary in (
            "PersonCanary",
            "namecanary@example.invalid",
            "A-14",
            "TKT-CANARY-42",
            "212-555-0191",
            "URL-CANARY-42",
        ):
            self.assertNotIn(canary, rendered)
        self.assertIn("Night Lights", rendered)
        self.assertEqual(result.derivative.facts.event_date, "2027-08-12")
        self.assertTrue({"email", "person_label", "seat", "admission_code", "phone", "url_access_token"}.issubset(result.derivative.redaction_categories))

    def test_external_identifiers_do_not_grant_private_access_and_ttl_is_enforced(self):
        now = [datetime(2027, 1, 1, tzinfo=timezone.utc)]
        vault = PrivateOriginalVault(
            RetentionPolicy(ttl_seconds=60, allow_private_review=True),
            clock=lambda: now[0],
        )
        boundary = ContentBoundary(vault)
        tenant_a = TrustedTenantContext("tenant-alpha")
        tenant_b = TrustedTenantContext("tenant-beta")
        session = boundary.begin(
            tenant_a,
            SourceDocument(
                ContentModality.PLAIN_TEXT,
                "Night Lights",
                external_reference="tenant-beta",
            ),
        )
        ref = session.original_ref
        with self.assertRaises(PrivateEvidenceUnavailable):
            vault.read(tenant_b, ref)
        self.assertEqual(vault.read(tenant_a, ref), "Night Lights")
        now[0] += timedelta(seconds=61)
        with self.assertRaises(PrivateEvidenceUnavailable):
            vault.read(tenant_a, ref)
        self.assertEqual(vault.purge_expired(), 0)

    def test_private_review_access_can_be_disabled_while_scoped_retry_still_works(self):
        vault = PrivateOriginalVault(RetentionPolicy(ttl_seconds=60, allow_private_review=False))
        boundary = ContentBoundary(vault)
        context = TrustedTenantContext("tenant-private-review-disabled")
        session = boundary.begin(
            context,
            SourceDocument(ContentModality.PLAIN_TEXT, "Night Lights 2027-08-12"),
        )
        with self.assertRaises(PrivateEvidenceUnavailable):
            vault.read(context, session.original_ref)
        restarted = boundary.restart(context, session.original_ref)
        self.assertIs(restarted.prepare({"event_name": "Night Lights"}), SessionState.REDACTED)
        self.assertIs(restarted.publish().state, SessionState.PUBLISHED)

    def test_publish_is_idempotent_after_success(self):
        session = self.boundary.begin(
            self.context,
            SourceDocument(ContentModality.PLAIN_TEXT, "Night Lights 2027-08-12"),
        )
        session.prepare({"event_name": "Night Lights"})
        first = session.publish()
        second = session.publish()
        self.assertIs(second.state, SessionState.PUBLISHED)
        self.assertEqual(second.derivative, first.derivative)

    def test_diagnostics_contain_codes_not_source_values(self):
        marker = "DIAGNOSTIC-PRIVATE-CANARY"
        session = self.boundary.begin(
            self.context,
            SourceDocument(ContentModality.IMAGE_BINARY, marker.encode("utf-8"), external_reference=marker),
        )
        session.prepare({"event_name": "Night Lights"})
        summary = repr(safe_diagnostics(session.result()))
        self.assertNotIn(marker, summary)
        self.assertEqual(safe_diagnostics(session.result())["reason_code"], "opaque_binary_requires_review")

    def test_diagnostics_reject_a_caller_constructed_result(self):
        marker = "FORGED-DIAGNOSTIC-CANARY"
        forged = BoundaryResult(
            record_id=marker,
            state=SessionState.PUBLISHED,
            modality=marker,
            provenance=EvidenceProvenance(marker, marker),
            original_ref=PrivateOriginalRef(marker),
        )
        with self.assertRaises(ValueError):
            safe_diagnostics(forged)


if __name__ == "__main__":
    unittest.main()
