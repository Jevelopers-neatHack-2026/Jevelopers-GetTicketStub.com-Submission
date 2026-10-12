-- CI10 additive metadata reader over reviewed0009/0012 relations.
-- No data mutation, raw payload exposure, new operation grant or core-health change.
-- Transient probe policies verify parser-normalized predecessors and are removed
-- in this same migration transaction. The cleanup exception is whole-file pinned.
DO $lineage_policies$
BEGIN
  EXECUTE $policy$CREATE POLICY ci10_lineage_expected_inbox ON cost_intelligence.usage_intake_inbox
    FOR ALL TO ci_finance_runtime USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=usage_intake_inbox.tenant_id AND quarantine.project_id=usage_intake_inbox.project_id
          AND quarantine.environment=usage_intake_inbox.environment AND quarantine.billing_mode=usage_intake_inbox.billing_mode)) WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=usage_intake_inbox.tenant_id AND quarantine.project_id=usage_intake_inbox.project_id
          AND quarantine.environment=usage_intake_inbox.environment AND quarantine.billing_mode=usage_intake_inbox.billing_mode))$policy$;
  EXECUTE $policy$CREATE POLICY ci10_lineage_expected_attempts ON cost_intelligence.usage_intake_attempts
    FOR ALL TO ci_finance_runtime USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=usage_intake_attempts.tenant_id AND quarantine.project_id=usage_intake_attempts.project_id
          AND quarantine.environment=usage_intake_attempts.environment AND quarantine.billing_mode=usage_intake_attempts.billing_mode)) WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=usage_intake_attempts.tenant_id AND quarantine.project_id=usage_intake_attempts.project_id
          AND quarantine.environment=usage_intake_attempts.environment AND quarantine.billing_mode=usage_intake_attempts.billing_mode))$policy$;
  EXECUTE $policy$CREATE POLICY ci10_lineage_expected_outbox ON cost_intelligence.usage_intake_outbox
    FOR ALL TO ci_finance_runtime USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=usage_intake_outbox.tenant_id AND quarantine.project_id=usage_intake_outbox.project_id
          AND quarantine.environment=usage_intake_outbox.environment AND quarantine.billing_mode=usage_intake_outbox.billing_mode)) WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine quarantine
        WHERE quarantine.tenant_id=usage_intake_outbox.tenant_id AND quarantine.project_id=usage_intake_outbox.project_id
          AND quarantine.environment=usage_intake_outbox.environment AND quarantine.billing_mode=usage_intake_outbox.billing_mode))$policy$;
  EXECUTE $policy$CREATE POLICY ci10_lineage_expected_snapshots ON cost_intelligence.reporting_snapshots
    FOR ALL TO ci_finance_runtime USING (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine q
        WHERE q.tenant_id=reporting_snapshots.tenant_id AND q.project_id=reporting_snapshots.project_id
          AND q.environment=reporting_snapshots.environment AND q.billing_mode=reporting_snapshots.billing_mode)) WITH CHECK (cost_intelligence.finance_scope_matches(tenant_id,project_id,environment,billing_mode)
      AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_privacy_quarantine q
        WHERE q.tenant_id=reporting_snapshots.tenant_id AND q.project_id=reporting_snapshots.project_id
          AND q.environment=reporting_snapshots.environment AND q.billing_mode=reporting_snapshots.billing_mode))$policy$;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('usage_intake_inbox','usage_intake_inbox_scope_policy','ci10_lineage_expected_inbox'),
      ('usage_intake_attempts','usage_intake_attempts_scope_policy','ci10_lineage_expected_attempts'),
      ('usage_intake_outbox','usage_intake_outbox_scope_policy','ci10_lineage_expected_outbox'),
      ('reporting_snapshots','reporting_snapshots_scope_policy','ci10_lineage_expected_snapshots')) expected(table_name,policy_name,probe_name)
    JOIN pg_namespace n ON n.nspname='cost_intelligence'
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.table_name
    LEFT JOIN pg_policy actual ON actual.polrelid=c.oid AND actual.polname=expected.policy_name
    JOIN pg_policy probe ON probe.polrelid=c.oid AND probe.polname=expected.probe_name
    WHERE actual.oid IS NULL OR
      ROW(actual.polcmd,actual.polpermissive,actual.polroles,pg_get_expr(actual.polqual,c.oid),pg_get_expr(actual.polwithcheck,c.oid))
      IS DISTINCT FROM
      ROW(probe.polcmd,probe.polpermissive,probe.polroles,pg_get_expr(probe.polqual,c.oid),pg_get_expr(probe.polwithcheck,c.oid))
      OR (SELECT count(*) FROM pg_policy all_policies WHERE all_policies.polrelid=c.oid) <> 2
  ) THEN RAISE EXCEPTION 'Stored lineage requires the reviewed intake and reporting scope policies'; END IF;
  EXECUTE 'DROP POLICY ci10_lineage_expected_inbox ON cost_intelligence.usage_intake_inbox';
  EXECUTE 'DROP POLICY ci10_lineage_expected_attempts ON cost_intelligence.usage_intake_attempts';
  EXECUTE 'DROP POLICY ci10_lineage_expected_outbox ON cost_intelligence.usage_intake_outbox';
  EXECUTE 'DROP POLICY ci10_lineage_expected_snapshots ON cost_intelligence.reporting_snapshots';
  -- Bind original predecessor function bodies, not merely their function names.
  IF EXISTS (SELECT 1 FROM (VALUES
      ('usage_intake_inbox','usage_intake_inbox_append_only',27,'reject_usage_intake_audit_mutation()'),
      ('usage_intake_inbox','usage_intake_inbox_no_truncate',34,'reject_usage_intake_audit_mutation()'),
      ('usage_intake_attempts','usage_intake_attempt_identity_immutable',27,'guard_usage_intake_attempt_update()'),
      ('usage_intake_outbox','usage_intake_outbox_intent_immutable',27,'guard_usage_intake_outbox_update()'),
      ('reporting_snapshots','reporting_snapshots_append_only',27,'reject_ledger_projection_mutation()'),
      ('reporting_snapshots','reporting_snapshots_no_truncate',34,'reject_ledger_projection_mutation()')
    ) expected(table_name,trigger_name,trigger_type,function_identity)
    LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('cost_intelligence.' || expected.table_name) AND t.tgname=expected.trigger_name
    WHERE t.oid IS NULL OR t.tgisinternal OR t.tgtype IS DISTINCT FROM expected.trigger_type
      OR t.tgfoid IS DISTINCT FROM to_regprocedure('cost_intelligence.' || expected.function_identity)
      OR t.tgenabled NOT IN ('O','A') OR t.tgnargs<>0 OR octet_length(t.tgargs)<>0 OR t.tgattr<>''::int2vector
      OR t.tgqual IS NOT NULL OR t.tgconstraint<>0 OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL
  ) THEN RAISE EXCEPTION 'Stored lineage requires exact predecessor trigger bindings'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
      ('usage_intake_attempts',ARRAY['current_ledger_event_id'],'financial_ledger_events',ARRAY['event_id']),
      ('usage_intake_attempts',ARRAY['tenant_id','project_id','environment','billing_mode','first_observation_id'],'usage_intake_inbox',ARRAY['tenant_id','project_id','environment','billing_mode','source_observation_id']),
      ('usage_intake_attempts',ARRAY['tenant_id','project_id','environment','billing_mode','current_observation_id'],'usage_intake_inbox',ARRAY['tenant_id','project_id','environment','billing_mode','source_observation_id']),
      ('usage_intake_outbox',ARRAY['ledger_event_id'],'financial_ledger_events',ARRAY['event_id']),
      ('usage_intake_outbox',ARRAY['tenant_id','project_id','environment','billing_mode','source_observation_id'],'usage_intake_inbox',ARRAY['tenant_id','project_id','environment','billing_mode','source_observation_id']),
      ('usage_intake_outbox',ARRAY['tenant_id','project_id','environment','billing_mode','billable_attempt_id'],'usage_intake_attempts',ARRAY['tenant_id','project_id','environment','billing_mode','billable_attempt_id'])
    ) expected(table_name,source_columns,target_table,target_columns)
    WHERE (SELECT count(*) FROM pg_constraint k
      WHERE k.contype='f' AND k.conrelid=to_regclass('cost_intelligence.' || expected.table_name)
        AND k.confrelid=to_regclass('cost_intelligence.' || expected.target_table)
        AND ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY key(attnum,n)
          JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=key.attnum ORDER BY key.n)=expected.source_columns
        AND ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY key(attnum,n)
          JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=key.attnum ORDER BY key.n)=expected.target_columns
        AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
        AND k.confdeltype='r' AND k.confupdtype='a' AND k.confmatchtype='s') <> 1
  ) THEN RAISE EXCEPTION 'Stored lineage requires exact validated predecessor foreign keys'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
      ('reject_ledger_projection_mutation()','520d52b92447ad825848388b38bcba1aafdccdfd421121350e1f018ad6778e96'),
      ('finance_scope_matches(text,text,text,text)','487f9127a6f1647b8ceee3a3fd4643606158776b0b81d3d10425941da751557b'),
      ('reject_usage_intake_audit_mutation()','99bd69b02abebc1df9c0c4f28b558062b459bc3dd68a9ea962704fcd5cae0390'),
      ('guard_usage_intake_attempt_update()','40a400598ddf683bd907f9f7476d71b39365a826b2b111e40bd7ac1580253fe7'),
      ('guard_usage_intake_outbox_update()','3b837260e88374d8ac8a04bb0e4c736bbead14d60cf5f0d815ff71742fbdd504')
    ) expected(identity,body_hash)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure('cost_intelligence.' || expected.identity)
    WHERE p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_hash
  ) THEN RAISE EXCEPTION 'Stored lineage requires the reviewed source guard implementations'; END IF;
END $lineage_policies$;

CREATE INDEX usage_intake_outbox_ledger_lineage_idx ON cost_intelligence.usage_intake_outbox
  (tenant_id,project_id,environment,billing_mode,ledger_event_id,source_observation_id);

CREATE FUNCTION cost_intelligence.stored_lineage_reader_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $capabilities$
  SELECT jsonb_build_object(
    'indexes', (
      SELECT jsonb_agg(jsonb_build_object('name',expected.name,'definition',pg_get_indexdef(c.oid),
        'valid',i.indisvalid,'ready',i.indisready,'table',table_obj.relname,
        'owner',owner.rolname,'namespace',n.nspname) ORDER BY expected.name)
      FROM (VALUES ('usage_intake_inbox_pkey'),('usage_intake_attempts_pkey'),('usage_intake_outbox_pkey'),
        ('usage_intake_outbox_ledger_lineage_idx'),('reporting_snapshots_pkey'),('reporting_snapshots_scope_lookup')) expected(name)
      LEFT JOIN pg_namespace n ON n.nspname='cost_intelligence'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
      LEFT JOIN pg_index i ON i.indexrelid=c.oid
      LEFT JOIN pg_class table_obj ON table_obj.oid=i.indrelid
      LEFT JOIN pg_roles owner ON owner.oid=c.relowner
    ),
    'tables', (
      SELECT jsonb_agg(jsonb_build_object('name',expected.name,'kind',c.relkind,'owner',owner.rolname,
        'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
        'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
        'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
          (SELECT jsonb_agg(CASE WHEN principal.oid=0 THEN 'PUBLIC' ELSE r.rolname END ORDER BY principal.oid)
            FROM unnest(p.polroles) principal(oid) LEFT JOIN pg_roles r ON r.oid=principal.oid),
          pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
          FROM pg_policy p WHERE p.polrelid=c.oid),
        'guards',(SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
        'foreign_keys',(SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated) ORDER BY k.conname)
          FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f')
      ) ORDER BY expected.name)
      FROM (VALUES ('usage_intake_inbox'),('usage_intake_attempts'),('usage_intake_outbox'),('reporting_snapshots')) expected(name)
      LEFT JOIN pg_namespace n ON n.nspname='cost_intelligence'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
      LEFT JOIN pg_roles owner ON owner.oid=c.relowner
    ),
    'functions',(
      SELECT jsonb_agg(jsonb_build_array(expected.identity,pg_get_functiondef(p.oid),owner.rolname) ORDER BY expected.identity)
      FROM (VALUES ('reject_ledger_projection_mutation()'),('finance_scope_matches(text,text,text,text)'),
        ('reject_usage_intake_audit_mutation()'),('guard_usage_intake_attempt_update()'),('guard_usage_intake_outbox_update()')) expected(identity)
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure('cost_intelligence.' || expected.identity)
      LEFT JOIN pg_roles owner ON owner.oid=p.proowner
    )
  );
$capabilities$;
ALTER FUNCTION cost_intelligence.stored_lineage_reader_capabilities() OWNER TO ci_finance_owner;
REVOKE ALL ON FUNCTION cost_intelligence.stored_lineage_reader_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cost_intelligence.stored_lineage_reader_capabilities() TO ci_finance_runtime;

DO $lineage_health$
DECLARE installed jsonb;
BEGIN
  installed := cost_intelligence.stored_lineage_reader_capabilities();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(installed->'indexes') item
      WHERE item->>'table' NOT IN ('usage_intake_inbox','usage_intake_attempts','usage_intake_outbox','reporting_snapshots')
        OR item->>'table' IS NULL OR item->>'owner' IS DISTINCT FROM 'ci_finance_owner'
        OR item->>'valid' IS DISTINCT FROM 'true' OR item->>'ready' IS DISTINCT FROM 'true')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(installed->'tables') item
      WHERE item->>'owner' IS DISTINCT FROM 'ci_finance_owner' OR item->>'kind' IS DISTINCT FROM 'r'
        OR item->>'row_security' IS DISTINCT FROM 'true' OR item->>'force_row_security' IS DISTINCT FROM 'true'
        OR jsonb_array_length(item->'policies') IS DISTINCT FROM 1
        OR jsonb_array_length(item->'guards') IS DISTINCT FROM
          CASE WHEN item->>'name' IN ('usage_intake_inbox','reporting_snapshots') THEN 2 ELSE 1 END
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(item->'guards') guard WHERE guard->>2 NOT IN ('O','A'))
        OR (item->>'name' IN ('usage_intake_attempts','usage_intake_outbox')
          AND jsonb_array_length(item->'foreign_keys') IS DISTINCT FROM 3))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(installed->'functions') item WHERE item->>2 IS DISTINCT FROM 'ci_finance_owner')
    THEN RAISE EXCEPTION 'Stored lineage requires the reviewed immutable source capability'; END IF;
  EXECUTE format('CREATE VIEW cost_intelligence.stored_lineage_reader_health AS
    SELECT EXISTS (SELECT 1 FROM cost_intelligence.schema_migrations WHERE version=''0015_stored_lineage_reader'')
      AND cost_intelligence.stored_lineage_reader_capabilities()=%L::jsonb AS migrations_ready',installed::text);
END $lineage_health$;
REVOKE ALL ON cost_intelligence.stored_lineage_reader_health FROM PUBLIC;
GRANT SELECT ON cost_intelligence.stored_lineage_reader_health TO ci_finance_runtime;
