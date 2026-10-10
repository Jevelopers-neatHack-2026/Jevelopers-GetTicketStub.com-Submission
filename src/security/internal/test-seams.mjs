const TEST_SEAMS = new WeakMap();

export function createTestSeam(overrides) {
  if (!overrides || typeof overrides !== "object") throw new TypeError("Test seam must be an object");
  const options = Object.freeze({});
  TEST_SEAMS.set(options, Object.freeze({ ...overrides }));
  return options;
}

export function getTestSeam(options) {
  if (options === null || typeof options !== "object") return undefined;
  return TEST_SEAMS.get(options);
}
