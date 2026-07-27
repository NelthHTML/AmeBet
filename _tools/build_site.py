"""Transforme le bundle AmeBet.html en site statique déployable.

Le bundle embarque chaque ressource sous forme d'UUID (gzip + base64) et
laisse le runtime les remplacer par des blob: URLs au chargement. On fait
la même substitution, mais vers de vrais fichiers sur le disque.
"""
import base64
import gzip
import json
import os
import re
import shutil
import sys

SRC = sys.argv[1]
OUT = sys.argv[2]

html = open(SRC, "r", encoding="utf-8").read()


def grab(kind):
    m = re.search(r'<script type="__bundler/%s">(.*?)</script>' % kind, html, re.S)
    return m.group(1).strip() if m else None


manifest = json.loads(grab("manifest"))
template = json.loads(grab("template"))
ext = json.loads(grab("ext_resources") or "[]")
uuid2id = {e["uuid"]: e["id"] for e in ext}

# --- Fichiers nommés à la main : ce sont ceux que l'utilisateur va éditer ---
NAMED = {
    "1c9aab0c-1035-4cc8-9fb2-907b4c98eaa9": "amebet-store.js",
    "a459f7e2-c8a9-40f9-8dbd-4044bfc6e223": "firebase-config.js",
    "81b83dd7-c816-4d66-9443-6d36f95eb71a": "vendor/dc-runtime.js",
    "3a03fa4b-991a-46b9-8af4-d179f73a1786": "vendor/nocturne.js",
    "c7942fa3-930d-41d7-8ea9-5a715f535d11": "vendor/react.production.min.js",
    "f66b31de-a2b8-456e-ae3f-25365d111062": "vendor/react-dom.production.min.js",
}

# Formats de police redondants : woff2 + woff suffisent partout aujourd'hui.
# Les variantes SVG pèsent 6 Mo à elles seules, la TTF 1 Mo.
DROP_FORMATS = ("svg", "truetype")

EXT_BY_MIME = {
    "font/woff2": ".woff2",
    "font/woff": ".woff",
    "font/ttf": ".ttf",
    "image/svg+xml": ".svg",
    "text/javascript": ".js",
    "application/javascript": ".js",
}

# --- Retire les sources de police inutiles avant de résoudre les UUID ---
dropped = set()


def prune_src(m):
    block = m.group(0)
    kept = []
    for part in re.finditer(
            r'url\("([^"]+)"\)\s*format\("([^"]+)"\)', block):
        ref, fmt = part.group(1), part.group(2)
        if fmt in DROP_FORMATS:
            dropped.add(ref.split("#")[0])
            continue
        kept.append('url("%s") format("%s")' % (ref, fmt))
    if not kept:
        return block
    return "src:\n    " + ",\n    ".join(kept) + ";"


template = re.sub(r"src:\s*url\([^;]*;", prune_src, template)

# Un UUID écarté ici peut rester utilisé ailleurs : ne l'exclure que s'il
# n'apparaît plus du tout dans le template après élagage.
dropped = {u for u in dropped if u not in template}

# --- Noms de police lisibles, déduits du bloc @font-face qui les référence ---
face_of = {}
for face in re.finditer(r"@font-face\s*\{(.*?)\}", template, re.S):
    body = face.group(1)
    fam = re.search(r"font-family:\s*['\"]?([^;'\"]+)", body)
    weight = re.search(r"font-weight:\s*(\d+)", body)
    style = re.search(r"font-style:\s*(\w+)", body)
    label = (fam.group(1).strip() if fam else "font").replace(" ", "")
    if weight:
        label += "-" + weight.group(1)
    if style and style.group(1) != "normal":
        label += "-" + style.group(1)
    for ref in re.findall(r'url\("([^"]+)"\)', body):
        face_of.setdefault(ref.split("#")[0], label)

seen = {}
paths = {}
for uuid, entry in manifest.items():
    if uuid in dropped:
        continue
    if uuid in NAMED:
        paths[uuid] = NAMED[uuid]
        continue
    ext_ = EXT_BY_MIME.get(entry["mime"], ".bin")
    if uuid in face_of:
        base = face_of[uuid]
        n = seen.get(base, 0)
        seen[base] = n + 1
        paths[uuid] = "assets/fonts/%s-%d%s" % (base.lower(), n, ext_)
    else:
        paths[uuid] = "assets/%s%s" % (uuid[:8], ext_)

# --- Écriture des fichiers ---
if os.path.isdir(OUT):
    for name in ("assets", "vendor"):
        shutil.rmtree(os.path.join(OUT, name), ignore_errors=True)

written = 0
for uuid, rel in paths.items():
    entry = manifest[uuid]
    raw = base64.b64decode(entry["data"])
    if entry.get("compressed"):
        raw = gzip.decompress(raw)
    dest = os.path.join(OUT, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # firebase-config.js est édité par l'utilisateur : ne jamais l'écraser.
    if rel == "firebase-config.js" and os.path.exists(dest):
        print("  = firebase-config.js conservé (déjà présent)")
        continue
    with open(dest, "wb") as f:
        f.write(raw)
    written += 1

# --- Substitution des UUID dans le template ---
for uuid, rel in paths.items():
    template = template.replace(uuid, rel)

leftover = re.findall(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", template)
if leftover:
    print("  ! UUID non résolus :", set(leftover))

# --- window.__resources : ce que le runtime consultait via les blob URLs ---
resources = {}
for e in ext:
    if e["uuid"] in paths:
        resources[e["id"]] = "./" + paths[e["uuid"]]

inject = (
    "\n<!-- Résolution des modules : équivalent local de ce que faisait le\n"
    "     bundler avec des blob: URLs. React et le store sont servis depuis\n"
    "     ce dépôt, aucun CDN externe n'est contacté.\n"
    "     Les chemins sont absolutisés contre document.baseURI : le store est\n"
    "     chargé par un import() dynamique depuis vendor/dc-runtime.js, donc\n"
    "     un chemin relatif y serait résolu contre vendor/, pas contre la page. -->\n"
    "<script>window.__resources = (function (m) {\n"
    "  for (var k in m) m[k] = new URL(m[k], document.baseURI).href;\n"
    "  return m;\n"
    "})(%s);</script>\n"
    % json.dumps(resources, indent=2, ensure_ascii=False)
)
template = template.replace("<head>", "<head>" + inject, 1)

title = ("<title>AmeBet — carnet de paris</title>\n"
         '<link rel="icon" href="data:image/svg+xml,'
         "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
         "<rect width='32' height='32' rx='7' fill='%23161826'/>"
         "<text x='16' y='23' font-size='19' font-family='sans-serif' "
         "font-weight='700' fill='%239184d9' text-anchor='middle'>A</text>"
         '</svg>">\n')
template = template.replace(
    '<meta name="viewport"', title + '<meta name="viewport"', 1)

with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
    f.write(template)

total = sum(
    os.path.getsize(os.path.join(dp, f))
    for dp, _, fs in os.walk(OUT) for f in fs
    if "_extracted" not in dp and "_tools" not in dp and ".git" not in dp)
print("  %d fichiers écrits, index.html %d ko, total %.1f Mo"
      % (written, len(template) // 1024, total / 1e6))
