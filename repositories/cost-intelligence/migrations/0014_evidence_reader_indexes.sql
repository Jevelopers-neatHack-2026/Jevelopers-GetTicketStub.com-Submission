-- CI-10.2 reads only existing ledger references. No event/hold/accounting writes,
-- historical migration edits, or foundation-health changes. 0011 belongs to
-- settlement; 0013 belongs to the separately composable coverage-only slice.
-- Compare existing policies with parser-normalized equivalents of reviewed0006.
-- Temporary probes exist only within this transactional DO block, then disappear;
-- no altered or extra pre-existing policy may be captured as a healthy baseline.
DO $core_policies$
BEGIN
  EXECUTE $policy$CREATE POLICY ci10_expected_ledger_policy ON cost_intelligence.financial_ledger_events
    FOR ALL TO ci_finance_runtime
    USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=financial_ledger_events.tenant_id
          AND quarantine.project_id=financial_ledger_events.project_id
          AND quarantine.environment=financial_ledger_events.environment
          AND quarantine.billing_mode=financial_ledger_events.billing_mode))
    WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=financial_ledger_events.tenant_id
          AND quarantine.project_id=financial_ledger_events.project_id
          AND quarantine.environment=financial_ledger_events.environment
          AND quarantine.billing_mode=financial_ledger_events.billing_mode))$policy$;
  EXECUTE $policy$CREATE POLICY ci10_expected_privacy_policy ON cost_intelligence.financial_privacy_quarantine
    FOR SELECT TO ci_finance_runtime
    USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode))$policy$;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('financial_ledger_events','financial_ledger_events_scope_policy','ci10_expected_ledger_policy'),
      ('financial_privacy_quarantine','financial_privacy_quarantine_scope_policy','ci10_expected_privacy_policy')
    ) expected(table_name,policy_name,probe_name)
    JOIN pg_namespace n ON n.nspname='cost_intelligence'
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.table_name
    LEFT JOIN pg_policy actual ON actual.polrelid=c.oid AND actual.polname=expected.policy_name
    JOIN pg_policy probe ON probe.polrelid=c.oid AND probe.polname=expected.probe_name
    WHERE actual.oid IS NULL OR
      ROW(actual.polcmd,actual.polpermissive,actual.polroles,pg_get_expr(actual.polqual,c.oid),pg_get_expr(actual.polwithcheck,c.oid))
      IS DISTINCT FROM
      ROW(probe.polcmd,probe.polpermissive,probe.polroles,pg_get_expr(probe.polqual,c.oid),pg_get_expr(probe.polwithcheck,c.oid))
      OR (SELECT count(*) FROM pg_policy all_policies WHERE all_policies.polrelid=c.oid) <> 2
  ) THEN RAISE EXCEPTION 'CI evidence reader requires the reviewed ledger and quarantine scope policies'; END IF;
  EXECUTE 'DROP POLICY ci10_expected_ledger_policy ON cost_intelligence.financial_ledger_events';
  EXECUTE 'DROP POLICY ci10_expected_privacy_policy ON cost_intelligence.financial_privacy_quarantine';
  -- 0003 supplies the ledger UPDATE/DELETE guard. 0006 supplies both quarantine
  -- guards and denies runtime TRUNCATE. Bind those actual predecessor controls;
  -- do not invent or alter a core ledger trigger to satisfy this reader.
  IF EXISTS (SELECT 1 FROM (VALUES
      ('financial_ledger_events','financial_ledger_events_append_only',27,'reject_ledger_audit_mutation()'),
      ('financial_privacy_quarantine','financial_privacy_quarantine_append_only',27,'reject_financial_privacy_quarantine_mutation()'),
      ('financial_privacy_quarantine','financial_privacy_quarantine_no_truncate',34,'reject_financial_privacy_quarantine_mutation()')
    ) expected(table_name,trigger_name,trigger_type,function_identity)
    LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('cost_intelligence.' || expected.table_name) AND t.tgname=expected.trigger_name
    WHERE t.oid IS NULL OR t.tgisinternal OR t.tgtype IS DISTINCT FROM expected.trigger_type
      OR t.tgfoid IS DISTINCT FROM to_regprocedure('cost_intelligence.' || expected.function_identity)
      OR t.tgenabled NOT IN ('O','A') OR t.tgnargs<>0 OR octet_length(t.tgargs)<>0 OR t.tgattr<>''::int2vector
      OR t.tgqual IS NOT NULL OR t.tgconstraint<>0 OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL
  ) THEN RAISE EXCEPTION 'CI evidence reader requires exact predecessor trigger bindings'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('financial_ledger_events'),('financial_privacy_quarantine')) expected(name)
    LEFT JOIN pg_namespace n ON n.nspname='cost_intelligence'
    LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
    WHERE has_table_privilege('ci_finance_runtime',c.oid,'TRUNCATE') IS DISTINCT FROM false
  ) THEN RAISE EXCEPTION 'CI evidence reader requires restricted runtime table privileges'; END IF;
END $core_policies$;

CREATE INDEX financial_evidence_operation_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,logical_operation_id,event_id);
CREATE INDEX financial_evidence_transport_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,transport_attempt_id,event_id);
CREATE INDEX financial_evidence_provider_attempt_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,provider_attempt_id,event_id);
CREATE INDEX financial_evidence_provider_request_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,provider_request_id,event_id);
CREATE INDEX financial_evidence_billable_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,billable_attempt_id,event_id);
CREATE INDEX financial_evidence_reservation_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,reservation_id,event_id);
CREATE INDEX financial_evidence_correlation_idx ON cost_intelligence.financial_ledger_events
  (tenant_id,project_id,environment,billing_mode,correlation_id,event_id);
-- Workflow/job use exact JSON containment, never a whole-dimensions projection.
CREATE INDEX financial_evidence_dimensions_idx ON cost_intelligence.financial_ledger_events
  USING gin (dimensions jsonb_path_ops);

-- Capture only this reader's installed indexes and existing scope/privacy
-- guards. Extra future settlement guards do not invalidate this capability.
-- The existing core function implementations and controlled-audit protocol
-- remain independently reviewed prerequisites, not new guarantees of this view.
CREATE FUNCTION cost_intelligence.evidence_reader_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $capabilities$
  SELECT jsonb_build_object(
    'indexes', (
      SELECT jsonb_agg(jsonb_build_object('name',expected.name,'definition',pg_get_indexdef(c.oid),
        'valid',i.indisvalid,'ready',i.indisready,'table',table_obj.relname,
        'owner',owner.rolname,'namespace',n.nspname) ORDER BY expected.name)
      FROM (VALUES ('financial_ledger_events_pkey'),('financial_ledger_unique_source_observation'),
        ('financial_evidence_operation_idx'),('financial_evidence_transport_idx'),
        ('financial_evidence_provider_attempt_idx'),('financial_evidence_provider_request_idx'),
        ('financial_evidence_billable_idx'),('financial_evidence_reservation_idx'),
        ('financial_evidence_correlation_idx'),('financial_evidence_dimensions_idx')) expected(name)
      LEFT JOIN pg_namespace n ON n.nspname='cost_intelligence'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
      LEFT JOIN pg_index i ON i.indexrelid=c.oid
      LEFT JOIN pg_class table_obj ON table_obj.oid=i.indrelid
      LEFT JOIN pg_roles owner ON owner.oid=c.relowner
    ),
    'tables', (
      SELECT jsonb_agg(jsonb_build_object('name',expected.name,'kind',c.relkind,
        'owner',owner.rolname,'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
        'runtime_truncate',has_table_privilege('ci_finance_runtime',c.oid,'TRUNCATE'),
        'policies', (SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
          (SELECT jsonb_agg(CASE WHEN principal.oid=0 THEN 'PUBLIC' ELSE r.rolname END ORDER BY principal.oid)
            FROM unnest(p.polroles) principal(oid) LEFT JOIN pg_roles r ON r.oid=principal.oid),
          pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
          FROM pg_policy p WHERE p.polrelid=c.oid),
        'guards', (SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
            AND t.tgname IN (expected.name || '_append_only',expected.name || '_no_truncate'))
      ) ORDER BY expected.name)
      FROM (VALUES ('financial_ledger_events'),('financial_privacy_quarantine')) expected(name)
      LEFT JOIN pg_namespace n ON n.nspname='cost_intelligence'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
      LEFT JOIN pg_roles owner ON owner.oid=c.relowner
    )
  );
$capabilities$;
ALTER FUNCTION cost_intelligence.evidence_reader_capabilities() OWNER TO ci_finance_owner;
REVOKE ALL ON FUNCTION cost_intelligence.evidence_reader_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cost_intelligence.evidence_reader_capabilities() TO ci_finance_runtime;

DO $health$
DECLARE installed jsonb;
BEGIN
  installed := cost_intelligence.evidence_reader_capabilities();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(installed->'indexes') item
      WHERE item->>'table' IS DISTINCT FROM 'financial_ledger_events'
        OR item->>'owner' IS DISTINCT FROM 'ci_finance_owner'
        OR item->>'valid' IS DISTINCT FROM 'true' OR item->>'ready' IS DISTINCT FROM 'true')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(installed->'tables') item
      WHERE item->>'owner' IS DISTINCT FROM 'ci_finance_owner' OR item->>'kind' IS DISTINCT FROM 'r'
        OR item->>'row_security' IS DISTINCT FROM 'true' OR item->>'force_row_security' IS DISTINCT FROM 'true'
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(item->'policies') policy WHERE policy->>0=item->>'name' || '_scope_policy')
        OR item->>'runtime_truncate' IS DISTINCT FROM 'false'
        OR jsonb_array_length(item->'guards') IS DISTINCT FROM
          CASE WHEN item->>'name' = 'financial_ledger_events' THEN 1 ELSE 2 END
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(item->'guards') guard WHERE guard->>2 NOT IN ('O','A'))) THEN
    RAISE EXCEPTION 'CI evidence reader requires the reviewed ledger privacy capability';
  END IF;
  EXECUTE format('CREATE VIEW cost_intelligence.evidence_reader_health AS
    SELECT EXISTS (SELECT 1 FROM cost_intelligence.schema_migrations WHERE version=''0014_evidence_reader_indexes'')
      AND cost_intelligence.evidence_reader_capabilities()=%L::jsonb AS migrations_ready', installed::text);
END $health$;
-- Installer-owned bounded readiness view, as with existing feature health.
-- Runtime gets no schema_migrations access and no new financial write grant.
REVOKE ALL ON cost_intelligence.evidence_reader_health FROM PUBLIC;
GRANT SELECT ON cost_intelligence.evidence_reader_health TO ci_finance_runtime;
