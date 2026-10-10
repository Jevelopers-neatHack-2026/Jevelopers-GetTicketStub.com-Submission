export const PDF_DECODER_VERSION = "6.4.299";
export const PDF_READER_CONFIG_VERSION = "ei-text-pdf/1";

export const PDF_LIMITS = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxPages: 20,
  maxPagePoints: 14_400,
  maxTextCodeUnits: 100_000,
  maxTextItemCodeUnits: 20_000,
  maxTextItems: 2_000,
  maxOutputBytes: 2 * 1024 * 1024,
  maxOutlineNodes: 10_000,
  maxOutlineDepth: 128,
});
