import assert from "node:assert/strict";
import test from "node:test";
import { RetrievalError } from "../../src/security/errors.mjs";
import { isPublicAddress, parseAndValidateUrl, sameAddress, validateHostname } from "../../src/security/url-policy.mjs";

function denied(operation) {
  assert.throws(operation, (error) => error instanceof RetrievalError && error.code === "POLICY_DENIED");
}

test("accepts only canonical public HTTP(S) URL authorities", () => {
  assert.equal(parseAndValidateUrl("https://example.org/news?q=1#section").url.href, "https://example.org/news?q=1");
  assert.equal(parseAndValidateUrl("http://example.org:80/").port, 80);
  assert.equal(parseAndValidateUrl("https://[2001:4860:4860::8888]/").hostname, "2001:4860:4860::8888");
});

test("compares peer addresses independent of IPv6 compression and mapped IPv4 spelling", () => {
  assert.equal(sameAddress("2001:4860:4860:0:0:0:0:8888", "2001:4860:4860::8888"), true);
  assert.equal(sameAddress("::ffff:127.0.0.1", "127.0.0.1"), true);
  assert.equal(sameAddress("8.8.8.8", "8.8.4.4"), false);
});

test("rejects unsupported schemes, authority tricks, credentials, and nonstandard ports", () => {
  for (const value of [
    "file:///etc/passwd", "ftp://example.org/", "http://user:pass@example.org/", "http://example.org@127.0.0.1/",
    "http://example.org:81/", "https://example.org:444/", "https://example.org:/", "http://example.org:00080/",
    "http://example.org\\@127.0.0.1/", "http://%65xample.org/", "http://example.org\n/", "http://example.org./",
  ]) denied(() => parseAndValidateUrl(value));
});

test("rejects alternate numeric IPv4 encodings before network use", () => {
  for (const value of ["http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/"]) {
    denied(() => parseAndValidateUrl(value));
  }
});

test("rejects localhost and reserved host suffixes", () => {
  for (const host of ["localhost", "service.localhost", "printer.local", "app.internal", "fixture.test", "sample.example", "site.onion"]) {
    denied(() => validateHostname(host));
  }
});

test("blocks sensitive IPv4 ranges including metadata, private, shared, documentation, and reserved ranges", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.31.0.1",
    "192.0.0.9", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.4", "203.0.113.9",
    "224.0.0.1", "240.0.0.1", "255.255.255.255",
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) assert.equal(isPublicAddress(address), true, address);
});

test("blocks IPv6 local, mapped, transition, multicast, and documentation ranges", () => {
  for (const address of [
    "::", "::1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "2001::1", "2002:0808:0808::1", "3fff::1",
  ]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("denies IANA special-purpose service prefixes as destinations", () => {
  for (const address of ["192.31.196.1", "192.52.193.1", "192.175.48.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("2620:4f:8000::1"), false);
});
