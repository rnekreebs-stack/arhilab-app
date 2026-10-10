"""Receive only the allowlisted test artifacts; verify native hashes before writing."""
import base64
import hashlib
import re
import sys
from pathlib import Path

variant, transcript, output = sys.argv[1:]
if variant not in {"debug", "release"}:
    raise ValueError("Unknown signing track")
text = Path(transcript).read_text(encoding="utf-8")
shots = {f"ui08-premium-user-{shot}.png": f"ui08-premium-pdf-user-{variant}-{shot}.png"
         for shot in ("settings", "cover", "section", "summary", "created")}
shots["pdf-examples/arhilab-rekalesa.pdf"] = "pdf-examples/arhilab-rekalesa.pdf"
names = re.findall(r"ARHILAB_FILE=(\S+)", text)
hashes = re.findall(r"ARHILAB_SHA256=([0-9a-f]{64})", text)
payloads = re.findall(r"ARHILAB_BASE64=([A-Za-z0-9+/=]+)", text)
if len(names) != len(shots) or set(names) != set(shots) or len(hashes) != len(names) or len(payloads) != len(names):
    raise ValueError(f"Incomplete/duplicate test artifact transfer: {names}")
for name, digest, encoded in zip(names, hashes, payloads):
    data = base64.b64decode(encoded, validate=True)
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Truncated/corrupt transfer: {name}")
    header = b"%PDF-" if name.endswith(".pdf") else b"\x89PNG\r\n\x1a\n"
    if not data.startswith(header):
        raise ValueError(f"Incorrect file header: {name}")
    target = Path(output) / shots[name]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
print(f"PASS {variant}: six native UI/PDF artifacts transferred with matching SHA-256")
