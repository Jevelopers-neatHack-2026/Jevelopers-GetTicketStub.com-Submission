-- CI-07 coverage-only dry runs. No ledger/budget mutation or foundation-health rewrite.
CREATE TABLE cost_intelligence.reconciliation_coverage_imports (
  tenant_id text NOT NULL, project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development','test','production')),
  billing_mode text NOT NULL CHECK (billing_mode IN ('live','sandbox','simulated')),
  source_id text NOT NULL, import_id text NOT NULL, revision bigint NOT NULL CHECK (revision >= 1),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  record_content jsonb NOT NULL CHECK (jsonb_typeof(record_content)='object'),
  PRIMARY KEY (tenant_id,project_id,environment,billing_mode,source_id,import_id,revision)
);
CREATE TABLE cost_intelligence.reconciliation_coverage_runs (
  tenant_id text NOT NULL, project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development','test','production')),
  billing_mode text NOT NULL CHECK (billing_mode IN ('live','sandbox','simulated')),
  run_id text PRIMARY KEY CHECK (run_id ~ '^sha256:[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[a-f0-9]{64}$'),
  run_content jsonb NOT NULL CHECK (jsonb_typeof(run_content)='object'),
  UNIQUE (tenant_id,project_id,environment,billing_mode,idempotency_key)
);
CREATE TRIGGER reconciliation_coverage_imports_append_only BEFORE UPDATE OR DELETE ON cost_intelligence.reconciliation_coverage_imports
  FOR EACH ROW EXECUTE FUNCTION cost_intelligence.reject_ledger_projection_mutation();
CREATE TRIGGER reconciliation_coverage_imports_no_truncate BEFORE TRUNCATE ON cost_intelligence.reconciliation_coverage_imports
  FOR EACH STATEMENT EXECUTE FUNCTION cost_intelligence.reject_ledger_projection_mutation();
CREATE TRIGGER reconciliation_coverage_runs_append_only BEFORE UPDATE OR DELETE ON cost_intelligence.reconciliation_coverage_runs
  FOR EACH ROW EXECUTE FUNCTION cost_intelligence.reject_ledger_projection_mutation();
CREATE TRIGGER reconciliation_coverage_runs_no_truncate BEFORE TRUNCATE ON cost_intelligence.reconciliation_coverage_runs
  FOR EACH STATEMENT EXECUTE FUNCTION cost_intelligence.reject_ledger_projection_mutation();
DO $coverage_tables$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['reconciliation_coverage_imports','reconciliation_coverage_runs'] LOOP
    EXECUTE format('ALTER TABLE cost_intelligence.%I OWNER TO ci_finance_owner', table_name);
    EXECUTE format('REVOKE ALL ON cost_intelligence.%I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON cost_intelligence.%I TO ci_finance_runtime', table_name);
    EXECUTE format('CREATE POLICY %I ON cost_intelligence.%I FOR ALL TO ci_finance_runtime
      USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
        AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine q
          WHERE q.tenant_id=%I.tenant_id AND q.project_id=%I.project_id AND q.environment=%I.environment AND q.billing_mode=%I.billing_mode))
      WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
        AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine q
          WHERE q.tenant_id=%I.tenant_id AND q.project_id=%I.project_id AND q.environment=%I.environment AND q.billing_mode=%I.billing_mode))',
      table_name || '_scope_policy', table_name, table_name, table_name, table_name, table_name, table_name, table_name, table_name, table_name);
    EXECUTE format('ALTER TABLE cost_intelligence.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE cost_intelligence.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $coverage_tables$;
-- Capture the exact installed capability set, not only the migration marker.
-- The expected descriptor is compiled into the view as an immutable literal.
-- Dropped tables/constraints, weakened policies or disabled guards fail closed.
CREATE FUNCTION cost_intelligence.reconciliation_coverage_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $capabilities$
  SELECT jsonb_agg(jsonb_build_object(
    'table', expected.name, 'kind', c.relkind, 'owner', owner.rolname,
    'row_security', c.relrowsecurity, 'force_row_security', c.relforcerowsecurity,
    'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints', (SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated,idx.indisvalid,idx.indisready) ORDER BY k.conname)
      FROM pg_constraint k LEFT JOIN pg_index idx ON idx.indexrelid=k.conindid WHERE k.conrelid=c.oid),
    'triggers', (SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname)
      FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
    'policies', (SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
        (SELECT jsonb_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid=ANY(p.polroles)),
        pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
      FROM pg_policy p WHERE p.polrelid=c.oid),
    'table_acl', c.relacl::text
  ) ORDER BY expected.name)
  FROM (VALUES ('reconciliation_coverage_imports'),('reconciliation_coverage_runs')) expected(name)
  LEFT JOIN pg_namespace n ON n.nspname='cost_intelligence'
  LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
  LEFT JOIN pg_roles owner ON owner.oid=c.relowner;
$capabilities$;
ALTER FUNCTION cost_intelligence.reconciliation_coverage_capabilities() OWNER TO ci_finance_owner;
REVOKE ALL ON FUNCTION cost_intelligence.reconciliation_coverage_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cost_intelligence.reconciliation_coverage_capabilities() TO ci_finance_runtime;
DO $health$
BEGIN
  EXECUTE format('CREATE VIEW cost_intelligence.reconciliation_coverage_health AS
    SELECT EXISTS (SELECT 1 FROM cost_intelligence.schema_migrations WHERE version=''0013_reconciliation_coverage_runs'')
      AND cost_intelligence.reconciliation_coverage_capabilities()=%L::jsonb AS migrations_ready',
    cost_intelligence.reconciliation_coverage_capabilities()::text);
END $health$;
-- Keep the installer's view ownership, as with the existing foundation/reporting
-- health views: the runtime role receives only this bounded readiness projection.
REVOKE ALL ON cost_intelligence.reconciliation_coverage_health FROM PUBLIC;
GRANT SELECT ON cost_intelligence.reconciliation_coverage_health TO ci_finance_runtime;
