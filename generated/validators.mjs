var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// validators.mjs
var CommonEnvelope_1_0_0 = validate20;
var schema31 = { "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://schemas.jevelopers.org/CommonEnvelope/1.0.0", "title": "CommonEnvelope", "type": "object", "additionalProperties": false, "required": ["contract", "schema_version", "policy_version", "event_id", "tenant_id", "project_id", "correlation_id", "producer", "occurred_at", "observed_at", "ingested_at", "environment", "billing_mode", "source_refs"], "properties": { "contract": { "const": "CommonEnvelope", "x-classification": "public" }, "schema_version": { "const": "1.0.0", "x-classification": "public" }, "policy_version": { "const": "1.0.0", "x-classification": "public" }, "event_id": { "$ref": "#/$defs/EventId", "x-classification": "internal" }, "tenant_id": { "$ref": "#/$defs/TenantId", "x-classification": "restricted" }, "project_id": { "$ref": "#/$defs/ProjectId", "x-classification": "restricted" }, "workflow_id": { "$ref": "#/$defs/WorkflowId", "x-classification": "internal" }, "run_id": { "$ref": "#/$defs/RunId", "x-classification": "internal" }, "job_id": { "$ref": "#/$defs/JobId", "x-classification": "internal" }, "artifact_id": { "$ref": "#/$defs/ArtifactId", "x-classification": "restricted" }, "design_id": { "$ref": "#/$defs/DesignId", "x-classification": "restricted" }, "design_version_id": { "$ref": "#/$defs/DesignVersionId", "x-classification": "restricted" }, "order_id": { "$ref": "#/$defs/OrderId", "x-classification": "restricted" }, "trace_id": { "$ref": "#/$defs/TraceId", "x-classification": "internal" }, "correlation_id": { "$ref": "#/$defs/CorrelationId", "x-classification": "internal" }, "evidence_id": { "$ref": "#/$defs/EvidenceId", "x-classification": "internal" }, "usage_event_id": { "$ref": "#/$defs/UsageEventId", "x-classification": "internal" }, "logical_operation_id": { "$ref": "#/$defs/LogicalOperationId", "x-classification": "internal" }, "provider_attempt_id": { "$ref": "#/$defs/ProviderAttemptId", "x-classification": "internal" }, "billable_attempt_id": { "$ref": "#/$defs/BillableAttemptId", "x-classification": "internal" }, "transport_attempt_id": { "$ref": "#/$defs/TransportAttemptId", "x-classification": "internal" }, "provider_request_id": { "$ref": "#/$defs/ProviderRequestId", "x-classification": "restricted" }, "producer": { "type": "object", "additionalProperties": false, "required": ["module", "source_revision", "build_revision"], "x-classification": "internal", "properties": { "module": { "type": "string", "enum": ["getticketstub.com", "agent-harness", "event-intelligence", "creative-engine", "print-production", "fulfillment-connectors", "cost-intelligence", "team-dashboard", "integration-evals", "shared-contracts"], "x-classification": "public" }, "source_revision": { "$ref": "#/$defs/SourceRevision", "x-classification": "public" }, "build_revision": { "type": "string", "pattern": "^[A-Za-z0-9_.-]{1,128}$", "x-classification": "internal" } } }, "occurred_at": { "$ref": "#/$defs/UtcTime", "x-classification": "internal" }, "observed_at": { "$ref": "#/$defs/UtcTime", "x-classification": "internal" }, "ingested_at": { "$ref": "#/$defs/UtcTime", "x-classification": "internal" }, "environment": { "type": "string", "enum": ["development", "test", "production"], "x-classification": "public" }, "billing_mode": { "type": "string", "enum": ["live", "sandbox", "simulated"], "x-classification": "public" }, "source_refs": { "type": "array", "maxItems": 100, "x-classification": "restricted", "items": { "type": "object", "additionalProperties": false, "required": ["kind", "id"], "properties": { "kind": { "type": "string", "enum": ["artifact", "evidence", "source_observation", "provider_request", "manifest"], "x-classification": "internal" }, "id": { "type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,256}$", "x-classification": "restricted" }, "content_hash": { "$ref": "#/$defs/Sha256", "x-classification": "restricted" } } } } }, "$defs": { "TenantId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'TenantId'>" }, "ProjectId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'ProjectId'>" }, "EventId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'EventId'>" }, "WorkflowId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'WorkflowId'>" }, "RunId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'RunId'>" }, "JobId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'JobId'>" }, "ArtifactId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'ArtifactId'>" }, "DesignId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'DesignId'>" }, "DesignVersionId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'DesignVersionId'>" }, "OrderId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'OrderId'>" }, "TraceId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'TraceId'>" }, "CorrelationId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'CorrelationId'>" }, "EvidenceId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'EvidenceId'>" }, "UsageEventId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'UsageEventId'>" }, "LogicalOperationId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'LogicalOperationId'>" }, "ProviderAttemptId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'ProviderAttemptId'>" }, "BillableAttemptId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'BillableAttemptId'>" }, "TransportAttemptId": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'TransportAttemptId'>" }, "ProviderRequestId": { "type": ["string", "null"], "minLength": 1, "maxLength": 256, "pattern": "^[A-Za-z0-9_.:-]+$", "tsType": "Brand<string, 'ProviderRequestId'> | null" }, "SourceRevision": { "type": "string", "pattern": "^[a-f0-9]{40}$", "tsType": "Brand<string, 'SourceRevision'>" }, "UtcTime": { "type": "string", "format": "utc-time", "tsType": "Brand<string, 'UtcTime'>" }, "Sha256": { "type": "string", "pattern": "^sha256:[a-f0-9]{64}$", "tsType": "Brand<string, 'Sha256'>" }, "ExactDecimal": { "type": "string", "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$", "tsType": "Brand<string, 'ExactDecimal'>" } } };
var schema50 = { "type": ["string", "null"], "minLength": 1, "maxLength": 256, "pattern": "^[A-Za-z0-9_.:-]+$", "tsType": "Brand<string, 'ProviderRequestId'> | null" };
var func0 = Object.prototype.hasOwnProperty;
var func97 = require_ucs2length().default;
var formats0 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
var formats36 = /^(?:(?:[0-9]{4})-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{3})?Z$/;
var pattern4 = new RegExp("^[A-Za-z0-9_.:-]+$", "u");
var pattern5 = new RegExp("^[a-f0-9]{40}$", "u");
var pattern6 = new RegExp("^[A-Za-z0-9_.-]{1,128}$", "u");
var pattern7 = new RegExp("^[A-Za-z0-9_.:-]{1,256}$", "u");
var pattern8 = new RegExp("^sha256:[a-f0-9]{64}$", "u");
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.contract === void 0 || !func0.call(data, "contract")) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contract" }, message: "must have required property 'contract'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.schema_version === void 0 || !func0.call(data, "schema_version")) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.policy_version === void 0 || !func0.call(data, "policy_version")) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "policy_version" }, message: "must have required property 'policy_version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.event_id === void 0 || !func0.call(data, "event_id")) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "event_id" }, message: "must have required property 'event_id'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.tenant_id === void 0 || !func0.call(data, "tenant_id")) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tenant_id" }, message: "must have required property 'tenant_id'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.project_id === void 0 || !func0.call(data, "project_id")) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "project_id" }, message: "must have required property 'project_id'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.correlation_id === void 0 || !func0.call(data, "correlation_id")) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "correlation_id" }, message: "must have required property 'correlation_id'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.producer === void 0 || !func0.call(data, "producer")) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "producer" }, message: "must have required property 'producer'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.occurred_at === void 0 || !func0.call(data, "occurred_at")) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "occurred_at" }, message: "must have required property 'occurred_at'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.observed_at === void 0 || !func0.call(data, "observed_at")) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "observed_at" }, message: "must have required property 'observed_at'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.ingested_at === void 0 || !func0.call(data, "ingested_at")) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ingested_at" }, message: "must have required property 'ingested_at'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.environment === void 0 || !func0.call(data, "environment")) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "environment" }, message: "must have required property 'environment'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    if (data.billing_mode === void 0 || !func0.call(data, "billing_mode")) {
      const err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "billing_mode" }, message: "must have required property 'billing_mode'" };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    if (data.source_refs === void 0 || !func0.call(data, "source_refs")) {
      const err13 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source_refs" }, message: "must have required property 'source_refs'" };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!func0.call(schema31.properties, key0)) {
        const err14 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.contract !== void 0 && func0.call(data, "contract")) {
      if ("CommonEnvelope" !== data.contract) {
        const err15 = { instancePath: instancePath + "/contract", schemaPath: "#/properties/contract/const", keyword: "const", params: { allowedValue: "CommonEnvelope" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0 && func0.call(data, "schema_version")) {
      if ("1.0.0" !== data.schema_version) {
        const err16 = { instancePath: instancePath + "/schema_version", schemaPath: "#/properties/schema_version/const", keyword: "const", params: { allowedValue: "1.0.0" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.policy_version !== void 0 && func0.call(data, "policy_version")) {
      if ("1.0.0" !== data.policy_version) {
        const err17 = { instancePath: instancePath + "/policy_version", schemaPath: "#/properties/policy_version/const", keyword: "const", params: { allowedValue: "1.0.0" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.event_id !== void 0 && func0.call(data, "event_id")) {
      let data3 = data.event_id;
      if (typeof data3 === "string") {
        if (!formats0.test(data3)) {
          const err18 = { instancePath: instancePath + "/event_id", schemaPath: "#/$defs/EventId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/event_id", schemaPath: "#/$defs/EventId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.tenant_id !== void 0 && func0.call(data, "tenant_id")) {
      let data4 = data.tenant_id;
      if (typeof data4 === "string") {
        if (!formats0.test(data4)) {
          const err20 = { instancePath: instancePath + "/tenant_id", schemaPath: "#/$defs/TenantId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/tenant_id", schemaPath: "#/$defs/TenantId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.project_id !== void 0 && func0.call(data, "project_id")) {
      let data5 = data.project_id;
      if (typeof data5 === "string") {
        if (!formats0.test(data5)) {
          const err22 = { instancePath: instancePath + "/project_id", schemaPath: "#/$defs/ProjectId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/project_id", schemaPath: "#/$defs/ProjectId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.workflow_id !== void 0 && func0.call(data, "workflow_id")) {
      let data6 = data.workflow_id;
      if (typeof data6 === "string") {
        if (!formats0.test(data6)) {
          const err24 = { instancePath: instancePath + "/workflow_id", schemaPath: "#/$defs/WorkflowId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
      } else {
        const err25 = { instancePath: instancePath + "/workflow_id", schemaPath: "#/$defs/WorkflowId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.run_id !== void 0 && func0.call(data, "run_id")) {
      let data7 = data.run_id;
      if (typeof data7 === "string") {
        if (!formats0.test(data7)) {
          const err26 = { instancePath: instancePath + "/run_id", schemaPath: "#/$defs/RunId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      } else {
        const err27 = { instancePath: instancePath + "/run_id", schemaPath: "#/$defs/RunId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.job_id !== void 0 && func0.call(data, "job_id")) {
      let data8 = data.job_id;
      if (typeof data8 === "string") {
        if (!formats0.test(data8)) {
          const err28 = { instancePath: instancePath + "/job_id", schemaPath: "#/$defs/JobId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
      } else {
        const err29 = { instancePath: instancePath + "/job_id", schemaPath: "#/$defs/JobId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.artifact_id !== void 0 && func0.call(data, "artifact_id")) {
      let data9 = data.artifact_id;
      if (typeof data9 === "string") {
        if (!formats0.test(data9)) {
          const err30 = { instancePath: instancePath + "/artifact_id", schemaPath: "#/$defs/ArtifactId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      } else {
        const err31 = { instancePath: instancePath + "/artifact_id", schemaPath: "#/$defs/ArtifactId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.design_id !== void 0 && func0.call(data, "design_id")) {
      let data10 = data.design_id;
      if (typeof data10 === "string") {
        if (!formats0.test(data10)) {
          const err32 = { instancePath: instancePath + "/design_id", schemaPath: "#/$defs/DesignId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      } else {
        const err33 = { instancePath: instancePath + "/design_id", schemaPath: "#/$defs/DesignId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.design_version_id !== void 0 && func0.call(data, "design_version_id")) {
      let data11 = data.design_version_id;
      if (typeof data11 === "string") {
        if (!formats0.test(data11)) {
          const err34 = { instancePath: instancePath + "/design_version_id", schemaPath: "#/$defs/DesignVersionId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
      } else {
        const err35 = { instancePath: instancePath + "/design_version_id", schemaPath: "#/$defs/DesignVersionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
    }
    if (data.order_id !== void 0 && func0.call(data, "order_id")) {
      let data12 = data.order_id;
      if (typeof data12 === "string") {
        if (!formats0.test(data12)) {
          const err36 = { instancePath: instancePath + "/order_id", schemaPath: "#/$defs/OrderId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
      } else {
        const err37 = { instancePath: instancePath + "/order_id", schemaPath: "#/$defs/OrderId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
    }
    if (data.trace_id !== void 0 && func0.call(data, "trace_id")) {
      let data13 = data.trace_id;
      if (typeof data13 === "string") {
        if (!formats0.test(data13)) {
          const err38 = { instancePath: instancePath + "/trace_id", schemaPath: "#/$defs/TraceId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
      } else {
        const err39 = { instancePath: instancePath + "/trace_id", schemaPath: "#/$defs/TraceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
    }
    if (data.correlation_id !== void 0 && func0.call(data, "correlation_id")) {
      let data14 = data.correlation_id;
      if (typeof data14 === "string") {
        if (!formats0.test(data14)) {
          const err40 = { instancePath: instancePath + "/correlation_id", schemaPath: "#/$defs/CorrelationId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      } else {
        const err41 = { instancePath: instancePath + "/correlation_id", schemaPath: "#/$defs/CorrelationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err41];
        } else {
          vErrors.push(err41);
        }
        errors++;
      }
    }
    if (data.evidence_id !== void 0 && func0.call(data, "evidence_id")) {
      let data15 = data.evidence_id;
      if (typeof data15 === "string") {
        if (!formats0.test(data15)) {
          const err42 = { instancePath: instancePath + "/evidence_id", schemaPath: "#/$defs/EvidenceId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
      } else {
        const err43 = { instancePath: instancePath + "/evidence_id", schemaPath: "#/$defs/EvidenceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err43];
        } else {
          vErrors.push(err43);
        }
        errors++;
      }
    }
    if (data.usage_event_id !== void 0 && func0.call(data, "usage_event_id")) {
      let data16 = data.usage_event_id;
      if (typeof data16 === "string") {
        if (!formats0.test(data16)) {
          const err44 = { instancePath: instancePath + "/usage_event_id", schemaPath: "#/$defs/UsageEventId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
      } else {
        const err45 = { instancePath: instancePath + "/usage_event_id", schemaPath: "#/$defs/UsageEventId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err45];
        } else {
          vErrors.push(err45);
        }
        errors++;
      }
    }
    if (data.logical_operation_id !== void 0 && func0.call(data, "logical_operation_id")) {
      let data17 = data.logical_operation_id;
      if (typeof data17 === "string") {
        if (!formats0.test(data17)) {
          const err46 = { instancePath: instancePath + "/logical_operation_id", schemaPath: "#/$defs/LogicalOperationId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
      } else {
        const err47 = { instancePath: instancePath + "/logical_operation_id", schemaPath: "#/$defs/LogicalOperationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err47];
        } else {
          vErrors.push(err47);
        }
        errors++;
      }
    }
    if (data.provider_attempt_id !== void 0 && func0.call(data, "provider_attempt_id")) {
      let data18 = data.provider_attempt_id;
      if (typeof data18 === "string") {
        if (!formats0.test(data18)) {
          const err48 = { instancePath: instancePath + "/provider_attempt_id", schemaPath: "#/$defs/ProviderAttemptId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
      } else {
        const err49 = { instancePath: instancePath + "/provider_attempt_id", schemaPath: "#/$defs/ProviderAttemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.billable_attempt_id !== void 0 && func0.call(data, "billable_attempt_id")) {
      let data19 = data.billable_attempt_id;
      if (typeof data19 === "string") {
        if (!formats0.test(data19)) {
          const err50 = { instancePath: instancePath + "/billable_attempt_id", schemaPath: "#/$defs/BillableAttemptId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        }
      } else {
        const err51 = { instancePath: instancePath + "/billable_attempt_id", schemaPath: "#/$defs/BillableAttemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err51];
        } else {
          vErrors.push(err51);
        }
        errors++;
      }
    }
    if (data.transport_attempt_id !== void 0 && func0.call(data, "transport_attempt_id")) {
      let data20 = data.transport_attempt_id;
      if (typeof data20 === "string") {
        if (!formats0.test(data20)) {
          const err52 = { instancePath: instancePath + "/transport_attempt_id", schemaPath: "#/$defs/TransportAttemptId/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
      } else {
        const err53 = { instancePath: instancePath + "/transport_attempt_id", schemaPath: "#/$defs/TransportAttemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err53];
        } else {
          vErrors.push(err53);
        }
        errors++;
      }
    }
    if (data.provider_request_id !== void 0 && func0.call(data, "provider_request_id")) {
      let data21 = data.provider_request_id;
      if (typeof data21 !== "string" && data21 !== null) {
        const err54 = { instancePath: instancePath + "/provider_request_id", schemaPath: "#/$defs/ProviderRequestId/type", keyword: "type", params: { type: schema50.type }, message: "must be string,null" };
        if (vErrors === null) {
          vErrors = [err54];
        } else {
          vErrors.push(err54);
        }
        errors++;
      }
      if (typeof data21 === "string") {
        if (func97(data21) > 256) {
          const err55 = { instancePath: instancePath + "/provider_request_id", schemaPath: "#/$defs/ProviderRequestId/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
        if (func97(data21) < 1) {
          const err56 = { instancePath: instancePath + "/provider_request_id", schemaPath: "#/$defs/ProviderRequestId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
        if (!pattern4.test(data21)) {
          const err57 = { instancePath: instancePath + "/provider_request_id", schemaPath: "#/$defs/ProviderRequestId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_.:-]+$" }, message: 'must match pattern "^[A-Za-z0-9_.:-]+$"' };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
      }
    }
    if (data.producer !== void 0 && func0.call(data, "producer")) {
      let data22 = data.producer;
      if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
        if (data22.module === void 0 || !func0.call(data22, "module")) {
          const err58 = { instancePath: instancePath + "/producer", schemaPath: "#/properties/producer/required", keyword: "required", params: { missingProperty: "module" }, message: "must have required property 'module'" };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
        if (data22.source_revision === void 0 || !func0.call(data22, "source_revision")) {
          const err59 = { instancePath: instancePath + "/producer", schemaPath: "#/properties/producer/required", keyword: "required", params: { missingProperty: "source_revision" }, message: "must have required property 'source_revision'" };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
        if (data22.build_revision === void 0 || !func0.call(data22, "build_revision")) {
          const err60 = { instancePath: instancePath + "/producer", schemaPath: "#/properties/producer/required", keyword: "required", params: { missingProperty: "build_revision" }, message: "must have required property 'build_revision'" };
          if (vErrors === null) {
            vErrors = [err60];
          } else {
            vErrors.push(err60);
          }
          errors++;
        }
        for (const key1 of Object.keys(data22)) {
          if (!(key1 === "module" || key1 === "source_revision" || key1 === "build_revision")) {
            const err61 = { instancePath: instancePath + "/producer", schemaPath: "#/properties/producer/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
        }
        if (data22.module !== void 0 && func0.call(data22, "module")) {
          let data23 = data22.module;
          if (typeof data23 !== "string") {
            const err62 = { instancePath: instancePath + "/producer/module", schemaPath: "#/properties/producer/properties/module/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
          if (!(data23 === "getticketstub.com" || data23 === "agent-harness" || data23 === "event-intelligence" || data23 === "creative-engine" || data23 === "print-production" || data23 === "fulfillment-connectors" || data23 === "cost-intelligence" || data23 === "team-dashboard" || data23 === "integration-evals" || data23 === "shared-contracts")) {
            const err63 = { instancePath: instancePath + "/producer/module", schemaPath: "#/properties/producer/properties/module/enum", keyword: "enum", params: { allowedValues: schema31.properties.producer.properties.module.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        if (data22.source_revision !== void 0 && func0.call(data22, "source_revision")) {
          let data24 = data22.source_revision;
          if (typeof data24 === "string") {
            if (!pattern5.test(data24)) {
              const err64 = { instancePath: instancePath + "/producer/source_revision", schemaPath: "#/$defs/SourceRevision/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{40}$" }, message: 'must match pattern "^[a-f0-9]{40}$"' };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
          } else {
            const err65 = { instancePath: instancePath + "/producer/source_revision", schemaPath: "#/$defs/SourceRevision/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
        }
        if (data22.build_revision !== void 0 && func0.call(data22, "build_revision")) {
          let data25 = data22.build_revision;
          if (typeof data25 === "string") {
            if (!pattern6.test(data25)) {
              const err66 = { instancePath: instancePath + "/producer/build_revision", schemaPath: "#/properties/producer/properties/build_revision/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_.-]{1,128}$" }, message: 'must match pattern "^[A-Za-z0-9_.-]{1,128}$"' };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
          } else {
            const err67 = { instancePath: instancePath + "/producer/build_revision", schemaPath: "#/properties/producer/properties/build_revision/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
        }
      } else {
        const err68 = { instancePath: instancePath + "/producer", schemaPath: "#/properties/producer/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err68];
        } else {
          vErrors.push(err68);
        }
        errors++;
      }
    }
    if (data.occurred_at !== void 0 && func0.call(data, "occurred_at")) {
      let data26 = data.occurred_at;
      if (typeof data26 === "string") {
        if (!formats36.test(data26)) {
          const err69 = { instancePath: instancePath + "/occurred_at", schemaPath: "#/$defs/UtcTime/format", keyword: "format", params: { format: "utc-time" }, message: 'must match format "utc-time"' };
          if (vErrors === null) {
            vErrors = [err69];
          } else {
            vErrors.push(err69);
          }
          errors++;
        }
      } else {
        const err70 = { instancePath: instancePath + "/occurred_at", schemaPath: "#/$defs/UtcTime/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err70];
        } else {
          vErrors.push(err70);
        }
        errors++;
      }
    }
    if (data.observed_at !== void 0 && func0.call(data, "observed_at")) {
      let data27 = data.observed_at;
      if (typeof data27 === "string") {
        if (!formats36.test(data27)) {
          const err71 = { instancePath: instancePath + "/observed_at", schemaPath: "#/$defs/UtcTime/format", keyword: "format", params: { format: "utc-time" }, message: 'must match format "utc-time"' };
          if (vErrors === null) {
            vErrors = [err71];
          } else {
            vErrors.push(err71);
          }
          errors++;
        }
      } else {
        const err72 = { instancePath: instancePath + "/observed_at", schemaPath: "#/$defs/UtcTime/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err72];
        } else {
          vErrors.push(err72);
        }
        errors++;
      }
    }
    if (data.ingested_at !== void 0 && func0.call(data, "ingested_at")) {
      let data28 = data.ingested_at;
      if (typeof data28 === "string") {
        if (!formats36.test(data28)) {
          const err73 = { instancePath: instancePath + "/ingested_at", schemaPath: "#/$defs/UtcTime/format", keyword: "format", params: { format: "utc-time" }, message: 'must match format "utc-time"' };
          if (vErrors === null) {
            vErrors = [err73];
          } else {
            vErrors.push(err73);
          }
          errors++;
        }
      } else {
        const err74 = { instancePath: instancePath + "/ingested_at", schemaPath: "#/$defs/UtcTime/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err74];
        } else {
          vErrors.push(err74);
        }
        errors++;
      }
    }
    if (data.environment !== void 0 && func0.call(data, "environment")) {
      let data29 = data.environment;
      if (typeof data29 !== "string") {
        const err75 = { instancePath: instancePath + "/environment", schemaPath: "#/properties/environment/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err75];
        } else {
          vErrors.push(err75);
        }
        errors++;
      }
      if (!(data29 === "development" || data29 === "test" || data29 === "production")) {
        const err76 = { instancePath: instancePath + "/environment", schemaPath: "#/properties/environment/enum", keyword: "enum", params: { allowedValues: schema31.properties.environment.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err76];
        } else {
          vErrors.push(err76);
        }
        errors++;
      }
    }
    if (data.billing_mode !== void 0 && func0.call(data, "billing_mode")) {
      let data30 = data.billing_mode;
      if (typeof data30 !== "string") {
        const err77 = { instancePath: instancePath + "/billing_mode", schemaPath: "#/properties/billing_mode/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err77];
        } else {
          vErrors.push(err77);
        }
        errors++;
      }
      if (!(data30 === "live" || data30 === "sandbox" || data30 === "simulated")) {
        const err78 = { instancePath: instancePath + "/billing_mode", schemaPath: "#/properties/billing_mode/enum", keyword: "enum", params: { allowedValues: schema31.properties.billing_mode.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err78];
        } else {
          vErrors.push(err78);
        }
        errors++;
      }
    }
    if (data.source_refs !== void 0 && func0.call(data, "source_refs")) {
      let data31 = data.source_refs;
      if (Array.isArray(data31)) {
        if (data31.length > 100) {
          const err79 = { instancePath: instancePath + "/source_refs", schemaPath: "#/properties/source_refs/maxItems", keyword: "maxItems", params: { limit: 100 }, message: "must NOT have more than 100 items" };
          if (vErrors === null) {
            vErrors = [err79];
          } else {
            vErrors.push(err79);
          }
          errors++;
        }
        const len0 = data31.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data32 = data31[i0];
          if (data32 && typeof data32 == "object" && !Array.isArray(data32)) {
            if (data32.kind === void 0 || !func0.call(data32, "kind")) {
              const err80 = { instancePath: instancePath + "/source_refs/" + i0, schemaPath: "#/properties/source_refs/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
              if (vErrors === null) {
                vErrors = [err80];
              } else {
                vErrors.push(err80);
              }
              errors++;
            }
            if (data32.id === void 0 || !func0.call(data32, "id")) {
              const err81 = { instancePath: instancePath + "/source_refs/" + i0, schemaPath: "#/properties/source_refs/items/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err81];
              } else {
                vErrors.push(err81);
              }
              errors++;
            }
            for (const key2 of Object.keys(data32)) {
              if (!(key2 === "kind" || key2 === "id" || key2 === "content_hash")) {
                const err82 = { instancePath: instancePath + "/source_refs/" + i0, schemaPath: "#/properties/source_refs/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err82];
                } else {
                  vErrors.push(err82);
                }
                errors++;
              }
            }
            if (data32.kind !== void 0 && func0.call(data32, "kind")) {
              let data33 = data32.kind;
              if (typeof data33 !== "string") {
                const err83 = { instancePath: instancePath + "/source_refs/" + i0 + "/kind", schemaPath: "#/properties/source_refs/items/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err83];
                } else {
                  vErrors.push(err83);
                }
                errors++;
              }
              if (!(data33 === "artifact" || data33 === "evidence" || data33 === "source_observation" || data33 === "provider_request" || data33 === "manifest")) {
                const err84 = { instancePath: instancePath + "/source_refs/" + i0 + "/kind", schemaPath: "#/properties/source_refs/items/properties/kind/enum", keyword: "enum", params: { allowedValues: schema31.properties.source_refs.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err84];
                } else {
                  vErrors.push(err84);
                }
                errors++;
              }
            }
            if (data32.id !== void 0 && func0.call(data32, "id")) {
              let data34 = data32.id;
              if (typeof data34 === "string") {
                if (!pattern7.test(data34)) {
                  const err85 = { instancePath: instancePath + "/source_refs/" + i0 + "/id", schemaPath: "#/properties/source_refs/items/properties/id/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_.:-]{1,256}$" }, message: 'must match pattern "^[A-Za-z0-9_.:-]{1,256}$"' };
                  if (vErrors === null) {
                    vErrors = [err85];
                  } else {
                    vErrors.push(err85);
                  }
                  errors++;
                }
              } else {
                const err86 = { instancePath: instancePath + "/source_refs/" + i0 + "/id", schemaPath: "#/properties/source_refs/items/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err86];
                } else {
                  vErrors.push(err86);
                }
                errors++;
              }
            }
            if (data32.content_hash !== void 0 && func0.call(data32, "content_hash")) {
              let data35 = data32.content_hash;
              if (typeof data35 === "string") {
                if (!pattern8.test(data35)) {
                  const err87 = { instancePath: instancePath + "/source_refs/" + i0 + "/content_hash", schemaPath: "#/$defs/Sha256/pattern", keyword: "pattern", params: { pattern: "^sha256:[a-f0-9]{64}$" }, message: 'must match pattern "^sha256:[a-f0-9]{64}$"' };
                  if (vErrors === null) {
                    vErrors = [err87];
                  } else {
                    vErrors.push(err87);
                  }
                  errors++;
                }
              } else {
                const err88 = { instancePath: instancePath + "/source_refs/" + i0 + "/content_hash", schemaPath: "#/$defs/Sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err88];
                } else {
                  vErrors.push(err88);
                }
                errors++;
              }
            }
          } else {
            const err89 = { instancePath: instancePath + "/source_refs/" + i0, schemaPath: "#/properties/source_refs/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
        }
      } else {
        const err90 = { instancePath: instancePath + "/source_refs", schemaPath: "#/properties/source_refs/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err90];
        } else {
          vErrors.push(err90);
        }
        errors++;
      }
    }
  } else {
    const err91 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err91];
    } else {
      vErrors.push(err91);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var PrimitiveTenantId = validate21;
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveProjectId = validate22;
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate22.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate22.errors = vErrors;
  return errors === 0;
}
validate22.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveEventId = validate23;
function validate23(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate23.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate23.errors = vErrors;
  return errors === 0;
}
validate23.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveWorkflowId = validate24;
function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate24.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate24.errors = vErrors;
  return errors === 0;
}
validate24.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveRunId = validate25;
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate25.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate25.errors = vErrors;
  return errors === 0;
}
validate25.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveJobId = validate26;
function validate26(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate26.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate26.errors = vErrors;
  return errors === 0;
}
validate26.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveArtifactId = validate27;
function validate27(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate27.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate27.errors = vErrors;
  return errors === 0;
}
validate27.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveDesignId = validate28;
function validate28(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate28.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate28.errors = vErrors;
  return errors === 0;
}
validate28.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveDesignVersionId = validate29;
function validate29(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate29.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate29.errors = vErrors;
  return errors === 0;
}
validate29.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveOrderId = validate30;
function validate30(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate30.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate30.errors = vErrors;
  return errors === 0;
}
validate30.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveTraceId = validate31;
function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate31.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate31.errors = vErrors;
  return errors === 0;
}
validate31.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveCorrelationId = validate32;
function validate32(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate32.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate32.errors = vErrors;
  return errors === 0;
}
validate32.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveEvidenceId = validate33;
function validate33(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate33.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate33.errors = vErrors;
  return errors === 0;
}
validate33.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveUsageEventId = validate34;
function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate34.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate34.errors = vErrors;
  return errors === 0;
}
validate34.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveLogicalOperationId = validate35;
function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate35.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate35.errors = vErrors;
  return errors === 0;
}
validate35.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveProviderAttemptId = validate36;
function validate36(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate36.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate36.errors = vErrors;
  return errors === 0;
}
validate36.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveBillableAttemptId = validate37;
function validate37(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate37.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate37.errors = vErrors;
  return errors === 0;
}
validate37.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveTransportAttemptId = validate38;
function validate38(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate38.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats0.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate38.errors = vErrors;
  return errors === 0;
}
validate38.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveProviderRequestId = validate39;
function validate39(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate39.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data !== "string" && data !== null) {
    const err0 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: schema50.type }, message: "must be string,null" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  }
  if (typeof data === "string") {
    if (func97(data) > 256) {
      const err1 = { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (func97(data) < 1) {
      const err2 = { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (!pattern4.test(data)) {
      const err3 = { instancePath, schemaPath: "#/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_.:-]+$" }, message: 'must match pattern "^[A-Za-z0-9_.:-]+$"' };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
  }
  validate39.errors = vErrors;
  return errors === 0;
}
validate39.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveSourceRevision = validate40;
function validate40(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate40.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!pattern5.test(data)) {
      const err0 = { instancePath, schemaPath: "#/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{40}$" }, message: 'must match pattern "^[a-f0-9]{40}$"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate40.errors = vErrors;
  return errors === 0;
}
validate40.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveUtcTime = validate41;
function validate41(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate41.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!formats36.test(data)) {
      const err0 = { instancePath, schemaPath: "#/format", keyword: "format", params: { format: "utc-time" }, message: 'must match format "utc-time"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate41.errors = vErrors;
  return errors === 0;
}
validate41.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveSha256 = validate42;
function validate42(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate42.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!pattern8.test(data)) {
      const err0 = { instancePath, schemaPath: "#/pattern", keyword: "pattern", params: { pattern: "^sha256:[a-f0-9]{64}$" }, message: 'must match pattern "^sha256:[a-f0-9]{64}$"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate42.errors = vErrors;
  return errors === 0;
}
validate42.evaluated = { "dynamicProps": false, "dynamicItems": false };
var PrimitiveExactDecimal = validate43;
var pattern12 = new RegExp("^(0|[1-9][0-9]*)(\\.[0-9]+)?$", "u");
function validate43(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate43.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (typeof data === "string") {
    if (!pattern12.test(data)) {
      const err0 = { instancePath, schemaPath: "#/pattern", keyword: "pattern", params: { pattern: "^(0|[1-9][0-9]*)(\\.[0-9]+)?$" }, message: 'must match pattern "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  validate43.errors = vErrors;
  return errors === 0;
}
validate43.evaluated = { "dynamicProps": false, "dynamicItems": false };
var EvidenceProjection_1_0_0 = validate44;
var schema79 = { "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://schemas.jevelopers.org/EvidenceProjection/1.0.0", "title": "EvidenceProjection", "type": "object", "additionalProperties": false, "required": ["contract", "schema_version", "policy_version", "evidence_id", "environment", "billing_mode", "outcome", "component"], "properties": { "contract": { "const": "EvidenceProjection", "x-classification": "public" }, "schema_version": { "const": "1.0.0", "x-classification": "public" }, "policy_version": { "const": "1.0.0", "x-classification": "public" }, "evidence_id": { "type": "string", "format": "uuid", "tsType": "Brand<string, 'PublicEvidenceId'>", "x-classification": "public" }, "environment": { "type": "string", "enum": ["development", "test", "production"], "x-classification": "public" }, "billing_mode": { "type": "string", "enum": ["live", "sandbox", "simulated"], "x-classification": "public" }, "outcome": { "type": "string", "enum": ["passed", "failed", "blocked", "unknown"], "x-classification": "public" }, "component": { "type": "object", "additionalProperties": false, "required": ["name", "source_revision"], "x-classification": "public", "properties": { "name": { "type": "string", "enum": ["getticketstub.com", "agent-harness", "event-intelligence", "creative-engine", "print-production", "fulfillment-connectors", "cost-intelligence", "team-dashboard", "integration-evals", "shared-contracts"], "x-classification": "public" }, "source_revision": { "type": "string", "pattern": "^[a-f0-9]{40}$", "tsType": "Brand<string, 'SourceRevision'>", "x-classification": "public" } } } } };
function validate44(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate44.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.contract === void 0 || !func0.call(data, "contract")) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contract" }, message: "must have required property 'contract'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.schema_version === void 0 || !func0.call(data, "schema_version")) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.policy_version === void 0 || !func0.call(data, "policy_version")) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "policy_version" }, message: "must have required property 'policy_version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.evidence_id === void 0 || !func0.call(data, "evidence_id")) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "evidence_id" }, message: "must have required property 'evidence_id'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.environment === void 0 || !func0.call(data, "environment")) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "environment" }, message: "must have required property 'environment'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.billing_mode === void 0 || !func0.call(data, "billing_mode")) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "billing_mode" }, message: "must have required property 'billing_mode'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.outcome === void 0 || !func0.call(data, "outcome")) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "outcome" }, message: "must have required property 'outcome'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.component === void 0 || !func0.call(data, "component")) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "component" }, message: "must have required property 'component'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    for (const key0 of Object.keys(data)) {
      if (!(key0 === "contract" || key0 === "schema_version" || key0 === "policy_version" || key0 === "evidence_id" || key0 === "environment" || key0 === "billing_mode" || key0 === "outcome" || key0 === "component")) {
        const err8 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.contract !== void 0 && func0.call(data, "contract")) {
      if ("EvidenceProjection" !== data.contract) {
        const err9 = { instancePath: instancePath + "/contract", schemaPath: "#/properties/contract/const", keyword: "const", params: { allowedValue: "EvidenceProjection" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0 && func0.call(data, "schema_version")) {
      if ("1.0.0" !== data.schema_version) {
        const err10 = { instancePath: instancePath + "/schema_version", schemaPath: "#/properties/schema_version/const", keyword: "const", params: { allowedValue: "1.0.0" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.policy_version !== void 0 && func0.call(data, "policy_version")) {
      if ("1.0.0" !== data.policy_version) {
        const err11 = { instancePath: instancePath + "/policy_version", schemaPath: "#/properties/policy_version/const", keyword: "const", params: { allowedValue: "1.0.0" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.evidence_id !== void 0 && func0.call(data, "evidence_id")) {
      let data3 = data.evidence_id;
      if (typeof data3 === "string") {
        if (!formats0.test(data3)) {
          const err12 = { instancePath: instancePath + "/evidence_id", schemaPath: "#/properties/evidence_id/format", keyword: "format", params: { format: "uuid" }, message: 'must match format "uuid"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/evidence_id", schemaPath: "#/properties/evidence_id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.environment !== void 0 && func0.call(data, "environment")) {
      let data4 = data.environment;
      if (typeof data4 !== "string") {
        const err14 = { instancePath: instancePath + "/environment", schemaPath: "#/properties/environment/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (!(data4 === "development" || data4 === "test" || data4 === "production")) {
        const err15 = { instancePath: instancePath + "/environment", schemaPath: "#/properties/environment/enum", keyword: "enum", params: { allowedValues: schema79.properties.environment.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.billing_mode !== void 0 && func0.call(data, "billing_mode")) {
      let data5 = data.billing_mode;
      if (typeof data5 !== "string") {
        const err16 = { instancePath: instancePath + "/billing_mode", schemaPath: "#/properties/billing_mode/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
      if (!(data5 === "live" || data5 === "sandbox" || data5 === "simulated")) {
        const err17 = { instancePath: instancePath + "/billing_mode", schemaPath: "#/properties/billing_mode/enum", keyword: "enum", params: { allowedValues: schema79.properties.billing_mode.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.outcome !== void 0 && func0.call(data, "outcome")) {
      let data6 = data.outcome;
      if (typeof data6 !== "string") {
        const err18 = { instancePath: instancePath + "/outcome", schemaPath: "#/properties/outcome/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
      if (!(data6 === "passed" || data6 === "failed" || data6 === "blocked" || data6 === "unknown")) {
        const err19 = { instancePath: instancePath + "/outcome", schemaPath: "#/properties/outcome/enum", keyword: "enum", params: { allowedValues: schema79.properties.outcome.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.component !== void 0 && func0.call(data, "component")) {
      let data7 = data.component;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        if (data7.name === void 0 || !func0.call(data7, "name")) {
          const err20 = { instancePath: instancePath + "/component", schemaPath: "#/properties/component/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        if (data7.source_revision === void 0 || !func0.call(data7, "source_revision")) {
          const err21 = { instancePath: instancePath + "/component", schemaPath: "#/properties/component/required", keyword: "required", params: { missingProperty: "source_revision" }, message: "must have required property 'source_revision'" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
        for (const key1 of Object.keys(data7)) {
          if (!(key1 === "name" || key1 === "source_revision")) {
            const err22 = { instancePath: instancePath + "/component", schemaPath: "#/properties/component/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
        if (data7.name !== void 0 && func0.call(data7, "name")) {
          let data8 = data7.name;
          if (typeof data8 !== "string") {
            const err23 = { instancePath: instancePath + "/component/name", schemaPath: "#/properties/component/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err23];
            } else {
              vErrors.push(err23);
            }
            errors++;
          }
          if (!(data8 === "getticketstub.com" || data8 === "agent-harness" || data8 === "event-intelligence" || data8 === "creative-engine" || data8 === "print-production" || data8 === "fulfillment-connectors" || data8 === "cost-intelligence" || data8 === "team-dashboard" || data8 === "integration-evals" || data8 === "shared-contracts")) {
            const err24 = { instancePath: instancePath + "/component/name", schemaPath: "#/properties/component/properties/name/enum", keyword: "enum", params: { allowedValues: schema79.properties.component.properties.name.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err24];
            } else {
              vErrors.push(err24);
            }
            errors++;
          }
        }
        if (data7.source_revision !== void 0 && func0.call(data7, "source_revision")) {
          let data9 = data7.source_revision;
          if (typeof data9 === "string") {
            if (!pattern5.test(data9)) {
              const err25 = { instancePath: instancePath + "/component/source_revision", schemaPath: "#/properties/component/properties/source_revision/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{40}$" }, message: 'must match pattern "^[a-f0-9]{40}$"' };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/component/source_revision", schemaPath: "#/properties/component/properties/source_revision/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
      } else {
        const err27 = { instancePath: instancePath + "/component", schemaPath: "#/properties/component/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
  } else {
    const err28 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err28];
    } else {
      vErrors.push(err28);
    }
    errors++;
  }
  validate44.errors = vErrors;
  return errors === 0;
}
validate44.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
export {
  CommonEnvelope_1_0_0,
  EvidenceProjection_1_0_0,
  PrimitiveArtifactId,
  PrimitiveBillableAttemptId,
  PrimitiveCorrelationId,
  PrimitiveDesignId,
  PrimitiveDesignVersionId,
  PrimitiveEventId,
  PrimitiveEvidenceId,
  PrimitiveExactDecimal,
  PrimitiveJobId,
  PrimitiveLogicalOperationId,
  PrimitiveOrderId,
  PrimitiveProjectId,
  PrimitiveProviderAttemptId,
  PrimitiveProviderRequestId,
  PrimitiveRunId,
  PrimitiveSha256,
  PrimitiveSourceRevision,
  PrimitiveTenantId,
  PrimitiveTraceId,
  PrimitiveTransportAttemptId,
  PrimitiveUsageEventId,
  PrimitiveUtcTime,
  PrimitiveWorkflowId
};
