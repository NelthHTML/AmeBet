"""Crée une archive de ce qui doit partir sur GitHub.

La liste des fichiers vient de l'index git, pas d'un parcours du dossier :
ce qui est dans .gitignore (_tools/, .claude/) est donc écarté d'office,
et l'archive contient exactement ce qu'un `git push` enverrait.
"""
import os
import subprocess
import sys
import zipfile

REPO = sys.argv[1]
DEST = sys.argv[2]
ROOT = "amebet"  # dossier englobant dans l'archive

files = subprocess.run(
    ["git", "-C", REPO, "diff", "--cached", "--name-only"],
    capture_output=True, text=True, check=True,
).stdout.split("\n")
files = sorted(f.strip() for f in files if f.strip())

if not files:
    sys.exit("Rien dans l'index git — lance `git add -A` d'abord.")

with zipfile.ZipFile(DEST, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in files:
        src = os.path.join(REPO, rel.replace("/", os.sep))
        if not os.path.exists(src):
            print("  ! absent du disque :", rel)
            continue
        z.write(src, ROOT + "/" + rel)

size = os.path.getsize(DEST)
print("%d fichiers, %.2f Mo" % (len(files), size / 1e6))
print(DEST)
