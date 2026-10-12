const records = {
  "MALFORMED_JSON": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "INVALID_PAYLOAD": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "UNSUPPORTED_VERSION": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "UNKNOWN_ENUM": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "SCOPE_MISMATCH": {
    "category": "authorization",
    "safe_message": "Request cannot be completed."
  },
  "STALE_APPROVAL": {
    "category": "authorization",
    "safe_message": "Request cannot be completed."
  },
  "UNSUPPORTED_CASE": {
    "category": "unsupported",
    "safe_message": "Request cannot be completed."
  },
  "CANCELLED": {
    "category": "cancellation",
    "safe_message": "Request cannot be completed."
  },
  "TIMEOUT": {
    "category": "timeout",
    "safe_message": "Request cannot be completed."
  },
  "RATE_LIMIT": {
    "category": "availability",
    "safe_message": "Request cannot be completed."
  },
  "PARTIAL_FAILURE": {
    "category": "partial",
    "safe_message": "Request cannot be completed."
  },
  "UNKNOWN_SIDE_EFFECT": {
    "category": "uncertainty",
    "safe_message": "Outcome remains unknown."
  },
  "UNKNOWN_USAGE": {
    "category": "uncertainty",
    "safe_message": "Outcome remains unknown."
  },
  "INVALID_TRANSITION": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "STALE_REVISION": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "REVISION_CONFLICT": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "INVALID_BATCH": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "INVALID_DISTRIBUTION": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "INVALID_RECEIPT": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "REFERENCE_MISMATCH": {
    "category": "authorization",
    "safe_message": "Request cannot be completed."
  },
  "UNCERTAIN_EXECUTION": {
    "category": "uncertainty",
    "safe_message": "Outcome remains unknown."
  },
  "CURRENCY_MISMATCH": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "INVALID_MONEY": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "PROFILE_UNREPRESENTABLE": {
    "category": "unsupported",
    "safe_message": "Request cannot be completed."
  },
  "CYCLIC_DEPENDENCY": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "DEPENDENT_BATCH": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "POLICY_MISMATCH": {
    "category": "authorization",
    "safe_message": "Request cannot be completed."
  },
  "TERMINAL_JOB": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "IDENTITY_COLLISION": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "OBSERVATION_CONFLICT": {
    "category": "validation",
    "safe_message": "Request cannot be completed."
  },
  "EXPIRED": {
    "category": "authorization",
    "safe_message": "Request cannot be completed."
  },
  "BUDGET_UNAVAILABLE": {
    "category": "availability",
    "safe_message": "Request cannot be completed."
  }
};
for (const record of Object.values(records)) Object.freeze(record);
export const errorRegistry = Object.freeze(records);
