"""Shared plaintext-policy matrix: each class hidden in escaped JSON keys, values and nesting."""

import json
from typing import Final

CLASSES: Final = {
    "provider-key": ("sk-proj-FICTIONALabcdefghijklmnop", "sensitive_content"),
    "private-key": ("-----BEGIN PRIVATE KEY-----", "sensitive_content"),
    "secret-canary": ("IE_SECRET_CANARY_FIXTURE", "sensitive_content"),
    "pii-canary": ("IE_PII_CANARY_FIXTURE", "sensitive_content"),
    "credential-pair": ("password=fictionalvalue123", "sensitive_content"),
    "signed-token": (
        "https://assets.example/file?token=fictional-access-value",
        "signed_access_url",
    ),
    "signed-signature": (
        "https://assets.example/file?X-Amz-Signature=fictional",
        "signed_access_url",
    ),
    "userinfo": ("https://user:pass@assets.example/file", "credential_url"),
    "invalid-url": ("http://[::1/file", "invalid_export_reference"),
}


def escape(text: str) -> str:
    """Escape every character so the raw bytes never contain the plaintext."""
    return "".join(f"\\u{ord(char):04x}" for char in text)


def carriers(text: str) -> dict[str, bytes]:
    """Place text in a decoded value, key, and embedded object/scalar/key JSON."""
    escaped = escape(text)
    inner_value = '{"k":"' + escaped + '"}'
    inner_key = '{"' + escaped + '":0}'
    return {
        "value": ('{"url":"' + escaped + '"}').encode(),
        "key": ('{"' + escaped + '":0}').encode(),
        "list": ('["' + escaped + '"]').encode(),
        "embedded-object": json.dumps({"body": inner_value}).encode(),
        "embedded-key": json.dumps({"body": inner_key}).encode(),
        "embedded-scalar": json.dumps({"body": '"' + escaped + '"'}).encode(),
    }


CASES: Final = [
    (f"{name}-{carrier}", payload, code)
    for name, (text, code) in CLASSES.items()
    for carrier, payload in carriers(text).items()
]

BENIGN: Final = (
    b'{"url":"https://assets.example/file?page=2","note":"hello"}',
    json.dumps({"body": '{"k":"ok"}', "scalar": '"ok"', "name": "value"}).encode(),
    ('{"' + escape("ordinary-key") + '":"' + escape("ordinary value") + '"}').encode(),
    b'{"text":"not json {"}',
)


def deep_scalar(levels: int) -> bytes:
    """A scalar string re-encoded as JSON `levels` times."""
    value = "ordinary"
    for _ in range(levels):
        value = json.dumps(value)
    return json.dumps({"body": value}).encode()
