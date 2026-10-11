-- Extracted verbatim (IF NOT EXISTS removed) from src/versions/store.mjs at dbbd10d.
-- It is the legacy openai-only private attribution schema the in-place widening migration must handle.
    CREATE TABLE private_provider_attributions (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('generate','edit','concepts.create')),
      provider_name TEXT NOT NULL CHECK(provider_name='openai'),
      provider_model TEXT NOT NULL,
      reservation_ref TEXT NOT NULL,
      billable_attempt_id TEXT NOT NULL,
      transport_attempt_id TEXT NOT NULL,
      dispatch_intent_ref TEXT NOT NULL,
      provider_request_id TEXT NOT NULL,
      provider_request_ref TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,project_id,job_id,transport_attempt_id),
      UNIQUE(tenant_id,project_id,dispatch_intent_ref),
      FOREIGN KEY(tenant_id,project_id,job_id,transport_attempt_id)
        REFERENCES creative_dispatch_intents(tenant_id,project_id,job_id,transport_attempt_id)
    ) STRICT;
    CREATE TRIGGER private_provider_attributions_no_update
      BEFORE UPDATE ON private_provider_attributions BEGIN SELECT RAISE(ABORT,'private provider attribution is immutable'); END;
    CREATE TRIGGER private_provider_attributions_no_delete
      BEFORE DELETE ON private_provider_attributions BEGIN SELECT RAISE(ABORT,'private provider attribution is immutable'); END;
    CREATE TABLE private_provider_usage_attributions (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('generate','edit','concepts.create')),
      provider_name TEXT NOT NULL CHECK(provider_name='openai'),
      provider_model TEXT NOT NULL,
      reservation_ref TEXT NOT NULL,
      billable_attempt_id TEXT NOT NULL,
      transport_attempt_id TEXT NOT NULL,
      dispatch_intent_ref TEXT NOT NULL,
      target_binding_sha256 TEXT NOT NULL,
      usage_sha256 TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,project_id,job_id,transport_attempt_id),
      UNIQUE(tenant_id,project_id,dispatch_intent_ref),
      FOREIGN KEY(tenant_id,project_id,job_id,transport_attempt_id)
        REFERENCES creative_dispatch_intents(tenant_id,project_id,job_id,transport_attempt_id)
    ) STRICT;
    CREATE TRIGGER private_provider_usage_attributions_no_update
      BEFORE UPDATE ON private_provider_usage_attributions BEGIN SELECT RAISE(ABORT,'private provider usage attribution is immutable'); END;
    CREATE TRIGGER private_provider_usage_attributions_no_delete
      BEFORE DELETE ON private_provider_usage_attributions BEGIN SELECT RAISE(ABORT,'private provider usage attribution is immutable'); END;
