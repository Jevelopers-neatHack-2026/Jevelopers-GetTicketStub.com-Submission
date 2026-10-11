export const catalogA = {
  localFormat: "connector-development-catalog/1",
  providerId: "fixture-provider-alpha",
  apiVersion: "fixture-api-1",
  catalogVersion: "alpha-r1",
  source: {
    reference: "fixture:alpha/catalog",
    revision: "revision:fixture-alpha-1",
    retrievedAt: "2026-10-10T10:00:00.000Z",
    evidenceMode: "synthetic_fixture",
    evidenceReference: "fixture:alpha:v1"
  },
  freshness: { maximumAgeSeconds: 3600 },
  products: [{
    sku: "poster-12x18",
    variantId: "matte-white",
    availability: "available",
    constraints: {
      dimensions: { state: "known", value: { width: "304.8", height: "457.2", depth: "0.3", unit: "mm" } },
      minimumBleed: { state: "known", value: { top: "3", right: "3", bottom: "3", left: "3", unit: "mm" } },
      minimumSafeArea: { state: "known", value: { top: "5", right: "5", bottom: "5", left: "5", unit: "mm" } },
      minimumResolutionDpi: { state: "known", value: 300 },
      surfaces: { state: "known", value: ["front"] },
      files: { state: "known", value: { types: ["image/png", "application/pdf"], minimumCount: 1, maximumCount: 2 } },
      color: { state: "known", value: { spaces: ["CMYK"], profiles: ["fixture-coated-v1"] } },
      options: { state: "known", value: ["matte", "gloss"] },
      materials: { state: "known", value: ["paper-200gsm"] },
      personalization: { state: "known", value: { modes: ["variable_text"], maximumFields: 2, maximumCharactersPerField: 40 } },
      destinations: { state: "known", value: [
        { countryCode: "US", regions: { state: "known", value: ["CA", "NY"] } },
        { countryCode: "GB", regions: { state: "known", value: [] } }
      ] },
      shipping: { state: "known", value: [
        { countryCode: "US", regionCode: null, methods: ["standard"] },
        { countryCode: "US", regionCode: "CA", methods: ["express", "standard"] },
        { countryCode: "US", regionCode: "NY", methods: ["standard"] },
        { countryCode: "GB", regionCode: null, methods: ["tracked"] }
      ] }
    },
    providerAttributes: {
      finishCode: "M-02",
      productionLine: "fixture-line-a",
      tags: ["paper", "poster"]
    }
  }]
};

export const catalogB = {
  localFormat: "connector-development-catalog/1",
  providerId: "fixture-provider-beta",
  apiVersion: "fixture-api-4",
  catalogVersion: "beta-r9",
  source: {
    reference: "fixture:beta/catalog",
    revision: "revision:fixture-beta-9",
    retrievedAt: "2026-10-10T10:05:00.000Z",
    evidenceMode: "synthetic_fixture",
    evidenceReference: "fixture:beta:v9"
  },
  freshness: { maximumAgeSeconds: 1800 },
  products: [{
    sku: "poster-12x18",
    variantId: "satin-black",
    availability: "available",
    constraints: {
      dimensions: { state: "known", value: { width: "300", height: "450", depth: "0.4", unit: "mm" } },
      minimumBleed: { state: "known", value: { top: "5", right: "5", bottom: "5", left: "5", unit: "mm" } },
      minimumSafeArea: { state: "known", value: { top: "8", right: "8", bottom: "8", left: "8", unit: "mm" } },
      minimumResolutionDpi: { state: "known", value: 600 },
      surfaces: { state: "known", value: ["front", "back"] },
      files: { state: "known", value: { types: ["application/pdf"], minimumCount: 2, maximumCount: 4 } },
      color: { state: "known", value: { spaces: ["RGB"], profiles: ["fixture-srgb-v4"] } },
      options: { state: "known", value: ["satin"] },
      materials: { state: "known", value: ["photo-paper"] },
      personalization: { state: "unsupported", reasonCode: "provider_declares_unsupported" },
      destinations: { state: "known", value: [
        { countryCode: "CA", regions: { state: "known", value: ["BC", "ON"] } }
      ] },
      shipping: { state: "known", value: [
        { countryCode: "CA", regionCode: null, methods: ["economy"] },
        { countryCode: "CA", regionCode: "BC", methods: ["economy", "tracked"] }
      ] }
    },
    providerAttributes: {
      finishCode: "S-09",
      productionLine: "fixture-line-b",
      tags: ["satin", "photo"]
    }
  }]
};

export function copyCatalog(value = catalogA) {
  return structuredClone(value);
}

export function selectionFor(snapshot, overrides = {}) {
  const product = snapshot.products[0];
  const constraints = product.constraints;
  const dimensions = constraints.dimensions.value;
  const bleed = constraints.minimumBleed.value;
  const safeArea = constraints.minimumSafeArea.value;
  const files = constraints.files.value;
  const color = constraints.color.value;
  const personalization = constraints.personalization.state === "known"
    ? { mode: constraints.personalization.value.modes[0], fields: [{ name: "title", characterCount: 18 }] }
    : null;
  return {
    snapshotIdentity: snapshot.snapshotIdentity,
    catalogContentIdentity: snapshot.catalogContentIdentity,
    sku: product.sku,
    variantId: product.variantId,
    specIdentity: product.specIdentity,
    dimensions: { width: dimensions.widthNm === "304800000" ? "304.8" : "300", height: dimensions.heightNm === "457200000" ? "457.2" : "450", depth: dimensions.depthNm === "300000" ? "0.3" : "0.4", unit: "mm" },
    bleed: { top: bleed.topNm === "3000000" ? "3" : "5", right: bleed.rightNm === "3000000" ? "3" : "5", bottom: bleed.bottomNm === "3000000" ? "3" : "5", left: bleed.leftNm === "3000000" ? "3" : "5", unit: "mm" },
    safeArea: { top: safeArea.topNm === "5000000" ? "5" : "8", right: safeArea.rightNm === "5000000" ? "5" : "8", bottom: safeArea.bottomNm === "5000000" ? "5" : "8", left: safeArea.leftNm === "5000000" ? "5" : "8", unit: "mm" },
    effectiveResolutionDpi: constraints.minimumResolutionDpi.value,
    surface: "front",
    fileType: files.types[0],
    fileCount: files.minimumCount,
    colorSpace: color.spaces[0],
    colorProfile: color.profiles[0],
    options: [constraints.options.value[0]],
    materials: [constraints.materials.value[0]],
    personalization,
    destination: snapshot.providerId === "fixture-provider-alpha" ? { countryCode: "US", regionCode: "CA" } : { countryCode: "CA", regionCode: "BC" },
    shippingMethod: snapshot.providerId === "fixture-provider-alpha" ? "express" : "economy",
    ...overrides
  };
}
