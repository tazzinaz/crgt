# CRGT development files

- `waveset-player.html` is the source of CRGT, the same file that is published as the Claude artifact.
- `build.py vNN` builds every copy in this repo from that source:
  - `index.html` and `sw.js`, the offline (home-screen) app;
  - `INSTALL.txt`;
  - the page inside CRGT Host and the Host's version line;
  - the Host's zip.
- `build.py --dsp FILE` writes `crgt-dsp.js`, the engine's AudioWorklet code. It is published next to the artifact for viewers that refuse `blob:` scripts.
- `offline-head.html`, `offline-meta.html` and `offline-tail.html` are the parts the offline page adds around the source:
  - the document head;
  - the version meta, icons and embedded fonts;
  - the update banner script.
- `tests/` holds Playwright tests (Chromium). `sh tests/run.sh WORKDIR vNN` runs them against a preview page and the offline page. Serve `WORKDIR` on port 8765 and `WORKDIR/off` on port 8766.
