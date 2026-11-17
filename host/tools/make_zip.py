#!/usr/bin/env python3
"""Packs CRGTHost.swiftpm as CRGT-Host.swiftpm.zip (the download on the setup page).
   python3 host/tools/make_zip.py"""
import os, zipfile
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.normpath(os.path.join(here, '..'))
pkg = os.path.join(root, 'CRGTHost.swiftpm')
out = os.path.join(root, 'CRGT-Host.swiftpm.zip')
names = []
with zipfile.ZipFile(out + '.tmp', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for d, dirs, files in os.walk(pkg):
        dirs[:] = sorted(x for x in dirs if not x.startswith('.') and x != '.build')
        rel = os.path.relpath(d, root)
        z.write(d, rel + '/')
        for f in sorted(files):
            if f.startswith('.'):
                continue
            p = os.path.join(d, f)
            z.write(p, os.path.join(rel, f))
            names.append(os.path.join(rel, f))
os.replace(out + '.tmp', out)
print('%s: %d files, %.0f KB' % (os.path.basename(out), len(names), os.path.getsize(out) / 1024))
