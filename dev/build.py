#!/usr/bin/env python3
"""Build every published copy of CRGT from dev/waveset-player.html (the artifact's own source).

  python3 dev/build.py v46

writes, in the repo:
  index.html                     the offline (home-screen) app: fonts embedded, manifest, icons, update banner
  sw.js                          its service worker (cache named after the version and the page's SHA-1)
  INSTALL.txt                    first line names the version
  host/.../Resources/crgt.html   the page CRGT Host carries inside the iPad app (same as index.html)
  host/index.html                "with CRGT vNN built in"
then rebuilds host/CRGT-Host.swiftpm.zip.

  python3 dev/build.py --preview OUT.html [--theme dark|light]

writes a preview page for the tests (the source in a plain document, as the artifact viewer shows it).

  python3 dev/build.py --dsp OUT/crgt-dsp.js

writes the engine's AudioWorklet code, published as crgt-dsp.js beside the artifact (the page loads it when a viewer
refuses blob: scripts). The artifact is published from waveset-player.html with files {"crgt-dsp.js": that file}.
The offline page is: offline-head.html, the source's <title>, offline-meta.html (version meta, icons, embedded
fonts), the rest of the source without its Google Fonts links, offline-tail.html (the update banner script).
"""
import hashlib, os, re, subprocess, sys

DEV = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(DEV)
SRC = os.path.join(DEV, 'waveset-player.html')
HOST_PAGE = os.path.join(REPO, 'host', 'CRGTHost.swiftpm', 'Sources', 'CRGTHost', 'Resources', 'crgt.html')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def lines(p):
    s = read(p)
    return (s[:-1] if s.endswith('\n') else s).split('\n')


def offline(version):
    a = read(SRC).split('\n')
    while a and a[-1] == '':
        a.pop()
    assert a[0].startswith('<title>'), 'the source should start with its <title>'
    drop = [r'<meta name="claude:viewport-fit-sides"', r'<link rel="preconnect" href="https://fonts\.googleapis\.com">',
            r'<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>', r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/css2']
    head_src = a[1:5]
    assert all(re.match(d, l) for d, l in zip(drop, head_src)), 'the source\'s head lines changed: ' + repr(head_src)
    meta = ['<meta name="crgt-offline" content="%s">' % version] + lines(os.path.join(DEV, 'offline-meta.html'))
    out = lines(os.path.join(DEV, 'offline-head.html')) + [a[0]] + meta + a[5:] + [''] + lines(os.path.join(DEV, 'offline-tail.html')) + ['']
    return '\n'.join(out)


def build(version):
    assert re.fullmatch(r'v\d+', version), 'version like v46'
    page = offline(version)
    write(os.path.join(REPO, 'index.html'), page)
    write(HOST_PAGE, page)
    sha = hashlib.sha1(page.encode('utf-8')).hexdigest()[:10]
    sw = read(os.path.join(REPO, 'sw.js'))
    sw, n = re.subn(r"const CACHE='crgt-v\d+-[0-9a-f]+';", "const CACHE='crgt-%s-%s';" % (version, sha), sw, count=1)
    assert n == 1, 'CACHE line not found in sw.js'
    write(os.path.join(REPO, 'sw.js'), sw)
    ins = read(os.path.join(REPO, 'INSTALL.txt'))
    ins, n = re.subn(r'^CRGT Sample Workstation, offline version \(v\d+\)', 'CRGT Sample Workstation, offline version (%s)' % version, ins, count=1)
    assert n == 1, 'first line of INSTALL.txt not found'
    write(os.path.join(REPO, 'INSTALL.txt'), ins)
    hi = read(os.path.join(REPO, 'host', 'index.html'))
    hi, n = re.subn(r'with CRGT v\d+ built in', 'with CRGT %s built in' % version, hi, count=1)
    assert n == 1, 'version line not found in host/index.html'
    write(os.path.join(REPO, 'host', 'index.html'), hi)
    subprocess.run([sys.executable, os.path.join(REPO, 'host', 'tools', 'make_zip.py')], check=True, stdout=subprocess.DEVNULL)
    print('built', version, 'cache', sha)


def dsp_js():
    """The engine's AudioWorklet code exactly as the page builds it (DSP_SRC): the text between the DSP markers, a
    newline, then PROC_SRC. Published as crgt-dsp.js next to the artifact, for viewers that refuse blob: scripts."""
    s = read(SRC)
    a, b = s.index('// ==DSP=='), s.index('// ==/DSP==')
    assert a < b and s.find('class WsHost', a) < b
    p0 = s.index('const PROC_SRC=`') + len('const PROC_SRC=`')
    p1 = s.index('`;', p0)
    proc = s[p0:p1]
    assert '\\' not in proc and '${' not in proc, 'PROC_SRC has escapes: copy it differently'
    return s[a:b] + '\n' + proc


def preview(out, theme=''):
    t = ' data-theme="%s"' % theme if theme in ('dark', 'light') else ''
    write(out, '<!doctype html><html%s><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
               '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' % t + read(SRC) + '\n</body></html>')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['--preview']:
        theme = args[args.index('--theme') + 1] if '--theme' in args else ''
        preview(args[1], theme)
    elif args[:1] == ['--offline']:      # just the offline page, to a file of your choice (for tests)
        write(args[2], offline(args[1]))
    elif args[:1] == ['--dsp']:          # crgt-dsp.js, the engine for the AudioWorklet (published with the artifact)
        write(args[1], dsp_js())
    elif len(args) == 1:
        build(args[0])
    else:
        print(__doc__)
        sys.exit(2)
