CREATE TABLE cost_intelligence.financial_ledger_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 256),
  ledger_schema_version text NOT NULL CHECK (ledger_schema_version = '1.0.0'),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  project_id text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
  correlation_id text NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 256),
  producer_module text NOT NULL CHECK (length(producer_module) BETWEEN 1 AND 128),
  producer_source_revision text NOT NULL CHECK (producer_source_revision ~ '^[a-f0-9]{40}$'),
  producer_build_revision text NOT NULL CHECK (length(producer_build_revision) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  billing_mode text NOT NULL CHECK (billing_mode IN ('live', 'sandbox', 'simulated')),
  evidence_mode text NOT NULL CHECK (evidence_mode IN ('mocked', 'sandbox', 'live')),
  verification_status text NOT NULL CHECK (verification_status IN ('verified', 'unverified', 'unknown')),
  event_type text NOT NULL CHECK (event_type IN (
    'usage_observation', 'reservation_authorized', 'dispatch', 'charge', 'consumption', 'reservation_release',
    'expense', 'revenue', 'refund', 'credit', 'discount', 'fee', 'tax', 'reimbursement', 'cash_movement',
    'reversal', 'adjustment', 'correction'
  )),
  classification text NOT NULL CHECK (classification IN (
    'sale', 'discount', 'sale_refund', 'pass_through_tax', 'supplier_credit', 'supplier_expense', 'reimbursement',
    'payout_transfer', 'direct_cost', 'operating_expense', 'operating_revenue', 'award_grant', 'capital_funding',
    'sponsorship', 'in_kind_support', 'payable_labor', 'reservation_memo', 'usage_memo'
  )),
  valuation text NOT NULL CHECK (valuation IN ('unknown', 'estimated', 'provider_confirmed')),
  settlement_status text NOT NULL CHECK (settlement_status IN ('unpaid', 'partly_paid', 'paid')),
  reconciliation_status text NOT NULL CHECK (reconciliation_status IN ('unmatched', 'matched', 'exception')),
  reservation_lifecycle text CHECK (reservation_lifecycle IS NULL OR reservation_lifecycle IN (
    'held', 'dispatched', 'outcome_unknown', 'partially_settled', 'settled', 'released', 'expired', 'held_for_reconciliation'
  )),
  logical_operation_id text NOT NULL CHECK (length(logical_operation_id) BETWEEN 1 AND 256),
  transport_attempt_id text NOT NULL CHECK (length(transport_attempt_id) BETWEEN 1 AND 256),
  provider_attempt_id text NOT NULL CHECK (length(provider_attempt_id) BETWEEN 1 AND 256),
  provider_request_id text CHECK (provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 256),
  billable_attempt_id text NOT NULL CHECK (length(billable_attempt_id) BETWEEN 1 AND 256),
  source_observation_id text NOT NULL CHECK (length(source_observation_id) BETWEEN 1 AND 256),
  source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 120),
  source_event_id text NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 256),
  source_object_id text NOT NULL CHECK (length(source_object_id) BETWEEN 1 AND 256),
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 128),
  source_revision_sequence bigint NOT NULL CHECK (source_revision_sequence >= 0),
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^sha256:[a-f0-9]{64}$'),
  quantity_completeness text NOT NULL CHECK (quantity_completeness IN ('unknown', 'incomplete', 'complete')),
  quantity_units jsonb NOT NULL CHECK (jsonb_typeof(quantity_units) = 'array'),
  amount numeric(58, 18),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_scale smallint NOT NULL CHECK (amount_scale BETWEEN 0 AND 18),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  pricing jsonb CHECK (pricing IS NULL OR jsonb_typeof(pricing) = 'object'),
  fx_evidence jsonb CHECK (fx_evidence IS NULL OR jsonb_typeof(fx_evidence) = 'object'),
  financial_effect boolean NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  supersedes_event_id text REFERENCES cost_intelligence.financial_ledger_events(event_id) ON DELETE RESTRICT,
  reverses_event_id text REFERENCES cost_intelligence.financial_ledger_events(event_id) ON DELETE RESTRICT,
  event_hash text NOT NULL CHECK (event_hash ~ '^sha256:[a-f0-9]{64}$'),
  event_payload jsonb NOT NULL CHECK (jsonb_typeof(event_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_ledger_amount_valuation_ck CHECK (
    (valuation = 'unknown' AND amount IS NULL) OR (valuation <> 'unknown' AND amount IS NOT NULL)
  ),
  CONSTRAINT financial_ledger_supersedes_not_self_ck CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> event_id),
  CONSTRAINT financial_ledger_reverses_not_self_ck CHECK (reverses_event_id IS NULL OR reverses_event_id <> event_id),
  CONSTRAINT financial_ledger_effect_type_ck CHECK (
    NOT financial_effect OR event_type IN (
      'charge', 'consumption', 'expense', 'revenue', 'refund', 'credit', 'discount', 'fee', 'tax',
      'reimbursement', 'cash_movement', 'reversal', 'adjustment', 'correction'
    )
  ),
  CONSTRAINT financial_ledger_reservation_memo_ck CHECK (
    event_type NOT IN ('reservation_authorized', 'dispatch', 'reservation_release') OR NOT financial_effect
  ),
  CONSTRAINT financial_ledger_unique_idempotency UNIQUE (tenant_id, project_id, idempotency_key),
  CONSTRAINT financial_ledger_unique_source_event UNIQUE (tenant_id, project_id, source_name, source_event_id),
  CONSTRAINT financial_ledger_unique_source_observation UNIQUE (tenant_id, project_id, source_observation_id)
);

CREATE INDEX financial_ledger_projection_scan_idx
  ON cost_intelligence.financial_ledger_events (tenant_id, project_id, environment, billing_mode, ingested_at, event_id)
  WHERE financial_effect;
CREATE INDEX financial_ledger_supersedes_idx
  ON cost_intelligence.financial_ledger_events (supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;
CREATE INDEX financial_ledger_reversal_idx
  ON cost_intelligence.financial_ledger_events (reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION cost_intelligence.reject_ledger_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial ledger audit rows are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER financial_ledger_events_append_only
  BEFORE UPDATE OR DELETE ON cost_intelligence.financial_ledger_events
  FOR EACH ROW EXECUTE FUNCTION cost_intelligence.reject_ledger_audit_mutation();

CREATE TABLE cost_intelligence.financial_ledger_identity_bindings (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  identity_kind text NOT NULL CHECK (identity_kind IN (
    'logical_operation', 'transport_attempt', 'provider_attempt', 'provider_request', 'billable_attempt', 'source_observation'
  )),
  identity_value text NOT NULL CHECK (length(identity_value) BETWEEN 1 AND 256),
  logical_operation_id text NOT NULL,
  first_event_id text REFERENCES cost_intelligence.financial_ledger_events(event_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, identity_kind, identity_value)
);

CREATE OR REPLACE FUNCTION cost_intelligence.guard_identity_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.first_event_id IS NOT NULL OR NEW.first_event_id IS NULL THEN
    RAISE EXCEPTION 'financial identity bindings are immutable after first event assignment' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_ledger_identity_binding_immutable
  BEFORE UPDATE OR DELETE ON cost_intelligence.financial_ledger_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION cost_intelligence.guard_identity_binding();

CREATE TABLE cost_intelligence.financial_source_revision_heads (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  source_name text NOT NULL,
  source_object_id text NOT NULL,
  current_revision_sequence bigint,
  current_event_id text REFERENCES cost_intelligence.financial_ledger_events(event_id) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, project_id, source_name, source_object_id),
  CHECK ((current_revision_sequence IS NULL) = (current_event_id IS NULL))
);

CREATE TABLE cost_intelligence.financial_billable_attempt_heads (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  billable_attempt_id text NOT NULL,
  logical_operation_id text NOT NULL,
  current_event_id text REFERENCES cost_intelligence.financial_ledger_events(event_id) ON DELETE RESTRICT,
  current_effect_hash text CHECK (current_effect_hash IS NULL OR current_effect_hash ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY (tenant_id, project_id, billable_attempt_id),
  CHECK ((current_event_id IS NULL) = (current_effect_hash IS NULL))
);

CREATE TABLE cost_intelligence.financial_projection_snapshots (
  snapshot_id text PRIMARY KEY CHECK (snapshot_id ~ '^sha256:[a-f0-9]{64}$'),
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  billing_mode text NOT NULL CHECK (billing_mode IN ('live', 'sandbox', 'simulated')),
  as_of timestamptz NOT NULL,
  event_count integer NOT NULL CHECK (event_count >= 0),
  projection_hash text NOT NULL CHECK (projection_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, environment, billing_mode, as_of, projection_hash)
);

CREATE TABLE cost_intelligence.financial_projection_amounts (
  snapshot_id text NOT NULL REFERENCES cost_intelligence.financial_projection_snapshots(snapshot_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  classification text NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  event_count integer NOT NULL CHECK (event_count > 0),
  known_amount_count integer NOT NULL CHECK (known_amount_count >= 0),
  unknown_amount_count integer NOT NULL CHECK (unknown_amount_count >= 0),
  known_subtotal numeric(58, 18),
  total_amount numeric(58, 18),
  amount_completeness text NOT NULL CHECK (amount_completeness IN ('unknown', 'partial', 'complete')),
  PRIMARY KEY (snapshot_id, event_type, classification, currency),
  CHECK ((unknown_amount_count = 0 AND amount_completeness = 'complete' AND total_amount IS NOT NULL)
      OR (unknown_amount_count > 0 AND total_amount IS NULL AND amount_completeness <> 'complete')),
  CHECK ((known_amount_count = 0) = (known_subtotal IS NULL))
);

CREATE TABLE cost_intelligence.financial_projection_quantities (
  snapshot_id text NOT NULL REFERENCES cost_intelligence.financial_projection_snapshots(snapshot_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  classification text NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unit_name text,
  relation text,
  observation_count integer NOT NULL CHECK (observation_count > 0),
  known_quantity_count integer NOT NULL CHECK (known_quantity_count >= 0),
  unknown_quantity_count integer NOT NULL CHECK (unknown_quantity_count >= 0),
  known_subtotal numeric(58, 18),
  total_quantity numeric(58, 18),
  quantity_completeness text NOT NULL CHECK (quantity_completeness IN ('unknown', 'incomplete', 'complete')),
  PRIMARY KEY (snapshot_id, event_type, classification, currency, unit_name, relation),
  CHECK ((unknown_quantity_count = 0 AND quantity_completeness = 'complete' AND total_quantity IS NOT NULL)
      OR (unknown_quantity_count > 0 AND total_quantity IS NULL AND quantity_completeness <> 'complete')),
  CHECK ((known_quantity_count = 0) = (known_subtotal IS NULL))
);

CREATE OR REPLACE VIEW cost_intelligence.foundation_health AS
WITH required(version) AS (
  VALUES ('0001_foundation'), ('0002_foundation_health'), ('0003_financial_ledger')
)
SELECT
  bool_and(m.version IS NOT NULL) AS migrations_ready,
  count(m.version)::integer AS required_migrations_present,
  max(m.applied_at) AS checked_at
FROM required r
LEFT JOIN cost_intelligence.schema_migrations m ON m.version = r.version;
