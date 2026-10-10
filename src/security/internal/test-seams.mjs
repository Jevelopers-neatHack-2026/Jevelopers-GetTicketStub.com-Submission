const TEST_SEAM = Symbol("event-intelligence-private-test-seam");

export function createTestSeam(overrides) {
  if (!overrides || typeof overrides !== "object") throw new TypeError("Test seam must be an object");
  return Object.freeze({ [TEST_SEAM]: Object.freeze({ ...overrides }) });
}

export function getTestSeam(options) {
  const seam = options?.[TEST_SEAM];
  return seam && typeof seam === "object" ? seam : undefined;
}
