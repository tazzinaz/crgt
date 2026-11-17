# CRGT Host

CRGT Sample Workstation as an iPad app, with the iPad's MIDI. Safari gives web pages no Web MIDI, and neither does any other iPad browser. This app runs the same CRGT in a web view and hands it the iPad's CoreMIDI ports as Web MIDI:

- **IDAM MIDI Host**: a Mac connected by cable, with the iPad enabled in Audio MIDI Setup (Ableton Live, Logic, any DAW).
- **USB and Bluetooth MIDI devices**, using iOS's own Bluetooth MIDI screens.
- **Wi-Fi MIDI**: Apple's network session, which a Mac joins from Audio MIDI Setup.
- **Other iPad apps**, which can play into a virtual port named `CRGT`.

Setup for players: **https://tazzinaz.github.io/crgt/host/**

## How it works

| File | What it does |
|---|---|
| `CRGTHost.swiftpm/` | The app project. It opens in Swift Playground on the iPad, and in Xcode on a Mac. |
| `Sources/CRGTHost/HostController.swift` | Holds the WKWebView and loads CRGT as `https://tazzinaz.github.io/crgt/`, so sessions are kept for that address. It answers the bridge and sends saved files to the share sheet. It also checks this site for a newer CRGT. |
| `Sources/CRGTHost/MIDIHub.swift` | CoreMIDI, using the MIDI 1.0 protocol over UMP. It connects every source and handles hot-plug, the virtual `CRGT` destination, sending to destinations, and the Wi-Fi network session. |
| `Sources/CRGTHost/UMP.swift` | Converts between UMP words and MIDI 1.0 bytes, including sysex split across packets. Pure Swift and tested on its own. |
| `Sources/CRGTHost/PageStore.swift` | Picks the CRGT to open: the newer of the copy built into the app (`Resources/crgt.html`) and the last one downloaded. CRGT opens with no connection. |
| `bridge.js` | The Web MIDI the page sees (`navigator.requestMIDIAccess`, ports, `onmidimessage`, `send`, `statechange`, sysex rules), plus `window.CRGT_HOST`. It's injected before CRGT's own scripts. |
| `tools/embed_bridge.py` | Copies `bridge.js` into `BridgeScript.swift`. Run it after editing `bridge.js`; CI checks the two match. |
| `tests/ump/main.swift` | UMP round-trip tests. |
| `index.html` | The setup page on GitHub Pages. |
| `CRGT-Host.swiftpm.zip` | The download linked from the setup page. |

Inside the app, CRGT turns MIDI on at the first launch and tries to start its sound without a tap. The app allows audio to play without a gesture. Its MIDI panel gets a row for this iPad: Wi-Fi MIDI, Bluetooth devices, and Mac over Bluetooth. Updates use the same banner as the home-screen app, and the app reloads into the new copy when you tap it.

## Building

GitHub Actions (`.github/workflows/host.yml`) builds every change on a Mac with Xcode 16 and with the newest Xcode. Each build:

1. checks `BridgeScript.swift` against `bridge.js`;
2. runs the UMP tests;
3. compiles for iPad with `swift build`;
4. builds the whole app, unsigned, with `xcodebuild`;
5. checks its Info.plist (Bluetooth, Local Network, background audio);
6. keeps an unsigned `.ipa` as a build artifact, for Sideloadly or AltStore.

After a new CRGT build, copy its `index.html` to `Sources/CRGTHost/Resources/crgt.html` and re-zip `CRGTHost.swiftpm` as `CRGT-Host.swiftpm.zip`. Installed apps don't need this step: they download new CRGT versions themselves.
