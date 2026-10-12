import type { Brand } from "./brands.js";
export type CapabilityMetadataValue = null | boolean | number | string | readonly CapabilityMetadataValue1[] | {
    readonly [k: string]: CapabilityMetadataValue2;
};
export type CapabilityMetadataValue1 = null | boolean | number | string | readonly CapabilityMetadataValue1[] | {
    readonly [k: string]: CapabilityMetadataValue2;
};
export type CapabilityMetadataValue2 = null | boolean | number | string | readonly CapabilityMetadataValue1[] | {
    readonly [k: string]: CapabilityMetadataValue2;
};
export interface FulfillmentCapabilitySnapshot {
    readonly contract: "FulfillmentCapabilitySnapshot";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly provider_id: string;
    readonly api_version: string;
    readonly catalog_version: string;
    readonly source: {
        readonly reference: string;
        readonly revision: string;
        readonly retrieved_at: string;
        readonly evidence_mode: "synthetic_fixture" | "documentation_reference" | "account_observation" | "unverified_import";
        readonly evidence_reference: string;
        readonly input_hash: Brand<string, "Sha256">;
    };
    readonly freshness: {
        readonly maximum_age_seconds: number;
        readonly fresh_until: string;
    };
    /**
     * @minItems 1
     * @maxItems 200
     */
    readonly products: readonly PrintSpec[];
    readonly content_identity: Brand<string, "Sha256">;
    readonly capture_identity: Brand<string, "Sha256">;
}
export interface PrintSpec {
    readonly contract: "PrintSpec";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly provider_id: string;
    readonly api_version: string;
    readonly sku: string;
    readonly variant_id: string;
    readonly availability: "available" | "removed" | "unknown";
    readonly constraints: {
        readonly physical_dimensions: {
            readonly state: "known";
            readonly value: {
                readonly width_nm: string;
                readonly height_nm: string;
                readonly depth_nm: string;
                readonly unit: "nm";
                readonly basis: "unspecified_physical_product";
            };
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly geometry: {
            readonly trim: {
                readonly state: "known";
                readonly value: {
                    readonly width_nm: string;
                    readonly height_nm: string;
                    readonly unit: "nm";
                    readonly evidence_ref: string;
                };
            } | {
                readonly state: "unknown";
                readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
            } | {
                readonly state: "unsupported";
                readonly reason_code: "provider_declares_unsupported";
            };
            readonly printable: {
                readonly state: "known";
                readonly value: {
                    readonly width_nm: string;
                    readonly height_nm: string;
                    readonly unit: "nm";
                    readonly evidence_ref: string;
                };
            } | {
                readonly state: "unknown";
                readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
            } | {
                readonly state: "unsupported";
                readonly reason_code: "provider_declares_unsupported";
            };
            readonly outer_frame: {
                readonly state: "known";
                readonly value: {
                    readonly width_nm: string;
                    readonly height_nm: string;
                    readonly unit: "nm";
                    readonly evidence_ref: string;
                };
            } | {
                readonly state: "unknown";
                readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
            } | {
                readonly state: "unsupported";
                readonly reason_code: "provider_declares_unsupported";
            };
        };
        readonly inset_geometry_basis: {
            readonly state: "known";
            readonly value: "trim" | "printable";
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly minimum_bleed: {
            readonly state: "known";
            readonly value: {
                readonly top_nm: string;
                readonly right_nm: string;
                readonly bottom_nm: string;
                readonly left_nm: string;
                readonly unit: "nm";
            };
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly minimum_safe_area: {
            readonly state: "known";
            readonly value: {
                readonly top_nm: string;
                readonly right_nm: string;
                readonly bottom_nm: string;
                readonly left_nm: string;
                readonly unit: "nm";
            };
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly minimum_resolution_dpi: {
            readonly state: "known";
            readonly value: number;
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly surfaces: {
            readonly state: "known";
            /**
             * @minItems 1
             * @maxItems 32
             */
            readonly value: readonly string[];
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly files: {
            readonly state: "known";
            readonly value: {
                /**
                 * @minItems 1
                 * @maxItems 32
                 */
                readonly mime_types: readonly string[];
                readonly minimum_count: number;
                readonly maximum_count: number;
            };
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly color: {
            readonly state: "known";
            readonly value: {
                /**
                 * @minItems 1
                 * @maxItems 32
                 */
                readonly spaces: readonly string[];
                /**
                 * @minItems 1
                 * @maxItems 64
                 */
                readonly profiles: readonly string[];
            };
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly options: {
            readonly state: "known";
            /**
             * @minItems 0
             * @maxItems 128
             */
            readonly value: readonly string[];
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly materials: {
            readonly state: "known";
            /**
             * @minItems 1
             * @maxItems 128
             */
            readonly value: readonly string[];
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly personalization: {
            readonly state: "known";
            readonly value: {
                /**
                 * @minItems 0
                 * @maxItems 32
                 */
                readonly modes: readonly string[];
                readonly maximum_fields: number;
                readonly maximum_characters_per_field: number;
            };
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly destinations: {
            readonly state: "known";
            /**
             * @minItems 1
             * @maxItems 256
             */
            readonly value: readonly {
                readonly country_code: string;
                readonly regions: {
                    readonly state: "known";
                    readonly value: {
                        readonly mode: "unrestricted";
                    } | {
                        readonly mode: "allowlist";
                        /**
                         * @minItems 1
                         * @maxItems 512
                         */
                        readonly codes: readonly string[];
                    };
                } | {
                    readonly state: "unknown";
                    readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope";
                } | {
                    readonly state: "unsupported";
                    readonly reason_code: "provider_declares_unsupported";
                };
            }[];
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
        readonly shipping: {
            readonly state: "known";
            /**
             * @minItems 1
             * @maxItems 1000
             */
            readonly value: readonly {
                readonly country_code: string;
                readonly region_code: string | null;
                /**
                 * @minItems 1
                 * @maxItems 64
                 */
                readonly methods: readonly string[];
            }[];
        } | {
            readonly state: "unknown";
            readonly reason_code: "not_exposed" | "not_in_source" | "not_confirmed" | "outside_scope" | "provider_declares_unsupported";
        } | {
            readonly state: "unsupported";
            readonly reason_code: "provider_declares_unsupported";
        };
    };
    readonly provider_metadata: {
        readonly [k: string]: CapabilityMetadataValue;
    };
    readonly spec_identity: Brand<string, "Sha256">;
}
