DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_finance_owner') THEN
    EXECUTE 'CREATE ROLE ci_finance_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_finance_migrator') THEN
    EXECUTE 'CREATE ROLE ci_finance_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_finance_runtime') THEN
    EXECUTE 'CREATE ROLE ci_finance_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('ci_finance_owner', 'ci_finance_runtime')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolcanlogin)
  ) OR EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'ci_finance_migrator'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin OR NOT rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'CI finance group roles must remain non-login, non-owner service roles without elevated attributes';
  END IF;
END
$roles$;

GRANT ci_finance_owner TO ci_finance_migrator;

CREATE OR REPLACE FUNCTION cost_intelligence.finance_scope_matches(
  row_tenant_id text,
  row_project_id text,
  row_environment text,
  row_billing_mode text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $scope$
  SELECT row_tenant_id = NULLIF(current_setting('cost_intelligence.tenant_id', true), '')
     AND row_project_id = NULLIF(current_setting('cost_intelligence.project_id', true), '')
     AND row_environment = NULLIF(current_setting('cost_intelligence.environment', true), '')
     AND row_billing_mode = NULLIF(current_setting('cost_intelligence.billing_mode', true), '')
$scope$;

CREATE TABLE cost_intelligence.financial_privacy_quarantine (
  record_kind text NOT NULL CHECK (record_kind IN ('ledger_event', 'projection_snapshot')),
  record_hash text NOT NULL CHECK (record_hash ~ '^sha256:[a-f0-9]{64}$'),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  project_id text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  billing_mode text NOT NULL CHECK (billing_mode IN ('live', 'sandbox', 'simulated')),
  reason_code text NOT NULL CHECK (reason_code IN ('legacy_sensitive_event_data', 'legacy_sensitive_projection_label')),
  audited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_kind, record_hash, reason_code)
);

CREATE FUNCTION cost_intelligence.reject_financial_privacy_quarantine_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $privacy$
BEGIN
  RAISE EXCEPTION 'financial privacy quarantine records are append-only' USING ERRCODE = '55000';
END;
$privacy$;

CREATE TRIGGER financial_privacy_quarantine_append_only
  BEFORE UPDATE OR DELETE ON cost_intelligence.financial_privacy_quarantine
  FOR EACH ROW EXECUTE FUNCTION cost_intelligence.reject_financial_privacy_quarantine_mutation();
CREATE TRIGGER financial_privacy_quarantine_no_truncate
  BEFORE TRUNCATE ON cost_intelligence.financial_privacy_quarantine
  FOR EACH STATEMENT EXECUTE FUNCTION cost_intelligence.reject_financial_privacy_quarantine_mutation();

CREATE FUNCTION cost_intelligence.audit_legacy_financial_privacy()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cost_intelligence
AS $audit$
BEGIN
  INSERT INTO cost_intelligence.financial_privacy_quarantine
    (record_kind, record_hash, tenant_id, project_id, environment, billing_mode, reason_code)
  SELECT 'ledger_event', event.event_hash, event.tenant_id, event.project_id, event.environment, event.billing_mode,
         'legacy_sensitive_event_data'
  FROM cost_intelligence.financial_ledger_events event
  WHERE event.event_payload::text ~* '(https?://|[?#@]|prompt|password|passwd|secret|authorization|bearer|private|address|email|(^|[^[:alnum:]])token([^[:alnum:]]))'
     OR event.source_refs::text ~* '(https?://|[?#@]|prompt|password|passwd|secret|authorization|bearer|private|address|email|(^|[^[:alnum:]])token([^[:alnum:]]))'
  ON CONFLICT DO NOTHING;

  INSERT INTO cost_intelligence.financial_privacy_quarantine
    (record_kind, record_hash, tenant_id, project_id, environment, billing_mode, reason_code)
  SELECT DISTINCT 'projection_snapshot', snapshot.snapshot_id, snapshot.tenant_id, snapshot.project_id,
         snapshot.environment, snapshot.billing_mode, 'legacy_sensitive_projection_label'
  FROM cost_intelligence.financial_projection_snapshots snapshot
  JOIN cost_intelligence.financial_projection_quantities quantity USING (snapshot_id)
  WHERE quantity.unit_name IS NOT NULL
    AND (quantity.unit_name ~* '(https?://|[?#@[:space:]]|prompt|password|passwd|secret|authorization|bearer|private|address|email|(^|[^[:alnum:]])token([^[:alnum:]]))'
      OR quantity.unit_name !~ '^[a-z][a-z0-9_]{0,63}$')
  ON CONFLICT DO NOTHING;
END
$audit$;

REVOKE ALL ON FUNCTION cost_intelligence.finance_scope_matches(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cost_intelligence.audit_legacy_financial_privacy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cost_intelligence.finance_scope_matches(text, text, text, text) TO ci_finance_runtime;

SELECT cost_intelligence.audit_legacy_financial_privacy();

ALTER SCHEMA cost_intelligence OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_ledger_events OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_ledger_identity_bindings OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_source_revision_heads OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_posting_attempt_mappings OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_projection_snapshots OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_projection_amounts OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_projection_quantities OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_ledger_quarantine OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.financial_privacy_quarantine OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.pricing_rule_versions OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.pricing_rate_card_versions OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.pricing_fx_rate_versions OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.pricing_operation_idempotency OWNER TO ci_finance_owner;
ALTER TABLE cost_intelligence.pricing_estimate_snapshots OWNER TO ci_finance_owner;
ALTER FUNCTION cost_intelligence.audit_legacy_financial_privacy() OWNER TO ci_finance_migrator;
GRANT EXECUTE ON FUNCTION cost_intelligence.audit_legacy_financial_privacy() TO ci_finance_migrator;

GRANT USAGE ON SCHEMA cost_intelligence TO ci_finance_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA cost_intelligence FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA cost_intelligence FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cost_intelligence FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cost_intelligence.finance_scope_matches(text, text, text, text) TO ci_finance_runtime;
GRANT SELECT ON cost_intelligence.foundation_health TO ci_finance_runtime;

GRANT SELECT, INSERT ON cost_intelligence.financial_ledger_events TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.financial_ledger_identity_bindings TO ci_finance_runtime;
GRANT UPDATE (first_event_id) ON cost_intelligence.financial_ledger_identity_bindings TO ci_finance_runtime;
GRANT SELECT, INSERT, UPDATE ON cost_intelligence.financial_source_revision_heads TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.financial_posting_attempt_mappings TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.financial_projection_snapshots TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.financial_projection_amounts TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.financial_projection_quantities TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.financial_ledger_quarantine TO ci_finance_runtime;
GRANT SELECT ON cost_intelligence.financial_privacy_quarantine TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.pricing_rule_versions TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.pricing_rate_card_versions TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.pricing_fx_rate_versions TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.pricing_operation_idempotency TO ci_finance_runtime;
GRANT SELECT, INSERT ON cost_intelligence.pricing_estimate_snapshots TO ci_finance_runtime;

CREATE POLICY financial_ledger_events_scope_policy ON cost_intelligence.financial_ledger_events
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode)
    AND NOT EXISTS (
      SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
      WHERE quarantine.record_kind = 'ledger_event' AND quarantine.record_hash = financial_ledger_events.event_hash
        AND quarantine.tenant_id = financial_ledger_events.tenant_id
        AND quarantine.project_id = financial_ledger_events.project_id
        AND quarantine.environment = financial_ledger_events.environment
        AND quarantine.billing_mode = financial_ledger_events.billing_mode
    ))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));

CREATE POLICY financial_ledger_identity_bindings_scope_policy ON cost_intelligence.financial_ledger_identity_bindings
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY financial_source_revision_heads_scope_policy ON cost_intelligence.financial_source_revision_heads
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY financial_posting_attempt_mappings_scope_policy ON cost_intelligence.financial_posting_attempt_mappings
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));

CREATE POLICY financial_privacy_quarantine_scope_policy ON cost_intelligence.financial_privacy_quarantine
  FOR SELECT TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY financial_ledger_quarantine_scope_policy ON cost_intelligence.financial_ledger_quarantine
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));

CREATE POLICY financial_projection_snapshots_scope_policy ON cost_intelligence.financial_projection_snapshots
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode)
    AND NOT EXISTS (
      SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
      WHERE quarantine.record_kind = 'projection_snapshot' AND quarantine.record_hash = financial_projection_snapshots.snapshot_id
        AND quarantine.tenant_id = financial_projection_snapshots.tenant_id
        AND quarantine.project_id = financial_projection_snapshots.project_id
        AND quarantine.environment = financial_projection_snapshots.environment
        AND quarantine.billing_mode = financial_projection_snapshots.billing_mode
    ))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY financial_projection_amounts_scope_policy ON cost_intelligence.financial_projection_amounts
  FOR ALL TO ci_finance_runtime
  USING (EXISTS (
    SELECT 1 FROM cost_intelligence.financial_projection_snapshots snapshot
    WHERE snapshot.snapshot_id = financial_projection_amounts.snapshot_id
      AND cost_intelligence.finance_scope_matches(snapshot.tenant_id, snapshot.project_id, snapshot.environment, snapshot.billing_mode)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM cost_intelligence.financial_projection_snapshots snapshot
    WHERE snapshot.snapshot_id = financial_projection_amounts.snapshot_id
      AND cost_intelligence.finance_scope_matches(snapshot.tenant_id, snapshot.project_id, snapshot.environment, snapshot.billing_mode)
  ));
CREATE POLICY financial_projection_quantities_scope_policy ON cost_intelligence.financial_projection_quantities
  FOR ALL TO ci_finance_runtime
  USING (EXISTS (
    SELECT 1 FROM cost_intelligence.financial_projection_snapshots snapshot
    WHERE snapshot.snapshot_id = financial_projection_quantities.snapshot_id
      AND cost_intelligence.finance_scope_matches(snapshot.tenant_id, snapshot.project_id, snapshot.environment, snapshot.billing_mode)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM cost_intelligence.financial_projection_snapshots snapshot
    WHERE snapshot.snapshot_id = financial_projection_quantities.snapshot_id
      AND cost_intelligence.finance_scope_matches(snapshot.tenant_id, snapshot.project_id, snapshot.environment, snapshot.billing_mode)
  ));

CREATE POLICY pricing_rule_versions_scope_policy ON cost_intelligence.pricing_rule_versions
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY pricing_rate_card_versions_scope_policy ON cost_intelligence.pricing_rate_card_versions
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY pricing_fx_rate_versions_scope_policy ON cost_intelligence.pricing_fx_rate_versions
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY pricing_operation_idempotency_scope_policy ON cost_intelligence.pricing_operation_idempotency
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));
CREATE POLICY pricing_estimate_snapshots_scope_policy ON cost_intelligence.pricing_estimate_snapshots
  FOR ALL TO ci_finance_runtime
  USING (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode))
  WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id, project_id, environment, billing_mode));

DO $row_security$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'financial_ledger_events', 'financial_ledger_identity_bindings', 'financial_source_revision_heads',
    'financial_posting_attempt_mappings', 'financial_projection_snapshots', 'financial_projection_amounts',
    'financial_projection_quantities', 'financial_ledger_quarantine', 'financial_privacy_quarantine',
    'pricing_rule_versions', 'pricing_rate_card_versions', 'pricing_fx_rate_versions',
    'pricing_operation_idempotency', 'pricing_estimate_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE cost_intelligence.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE cost_intelligence.%I FORCE ROW LEVEL SECURITY', relation_name);
  END LOOP;
END
$row_security$;

CREATE OR REPLACE VIEW cost_intelligence.foundation_health AS
WITH required(version) AS (
  VALUES
    ('0001_foundation'), ('0002_foundation_health'), ('0003_financial_ledger'),
    ('0004_pricing_catalog'), ('0005_pricing_valuation_history'), ('0006_finance_security_roles')
)
SELECT bool_and(m.version IS NOT NULL) AS migrations_ready,
       count(m.version)::integer AS required_migrations_present,
       max(m.applied_at) AS checked_at
FROM required r
LEFT JOIN cost_intelligence.schema_migrations m ON m.version = r.version;
