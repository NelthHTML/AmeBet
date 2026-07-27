"""Extrait le contenu d'un bundle d'artifact (manifest gzip+base64 + template)."""
import base64
import gzip
import json
import os
import re
import sys

src = sys.argv[1]
out = sys.argv[2]

html = open(src, "r", encoding="utf-8").read()


def grab(kind):
    m = re.search(
        r'<script type="__bundler/%s">(.*?)</script>' % kind, html, re.S)
    return m.group(1).strip() if m else None


manifest = json.loads(grab("manifest"))
template = json.loads(grab("template"))
ext = json.loads(grab("ext_resources") or "[]")

os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "template.html"), "w", encoding="utf-8") as f:
    f.write(template)

uuid2id = {e["uuid"]: e["id"] for e in ext}

assets = os.path.join(out, "assets")
os.makedirs(assets, exist_ok=True)

report = []
for uuid, entry in manifest.items():
    raw = base64.b64decode(entry["data"])
    if entry.get("compressed"):
        raw = gzip.decompress(raw)
    ident = uuid2id.get(uuid, uuid)
    safe = re.sub(r'[^A-Za-z0-9._-]', "_", ident)[-90:]
    path = os.path.join(assets, "%s__%s" % (uuid[:8], safe))
    with open(path, "wb") as f:
        f.write(raw)
    report.append((uuid, entry["mime"], len(raw), ident))

report.sort(key=lambda r: -r[2])
for uuid, mime, size, ident in report:
    print("%-10s %-32s %10d  %s" % (uuid[:8], mime, size, ident[:80]))
print("\ntemplate.html: %d octets" % len(template))
