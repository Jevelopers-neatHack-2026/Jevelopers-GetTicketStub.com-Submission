export function hasCredentialLikeText(value) {
  return [
    /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[^\s,;]+/i,
    /\bbearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/i,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]\s*["']?[^\s"';,]{8,}/i
  ].some((pattern) => pattern.test(value));
}
