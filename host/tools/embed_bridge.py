#!/usr/bin/env python3
"""Copies host/bridge.js into the app as BridgeScript.swift (CI checks the two match).
   python3 host/tools/embed_bridge.py"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'bridge.js')
out = os.path.join(here, '..', 'CRGTHost.swiftpm', 'Sources', 'CRGTHost', 'BridgeScript.swift')
js = open(src, encoding='utf-8').read()
assert '"""#' not in js, 'bridge.js must not contain """#'
assert '/*HOST_INFO*/null' in js, 'bridge.js lost its /*HOST_INFO*/null placeholder'
swift = ('// Generated from host/bridge.js by host/tools/embed_bridge.py: edit bridge.js, then run the script.\n\n'
         'import Foundation\n\n'
         'enum BridgeScript {\n'
         '    /// The bridge with the app\'s version filled in (a JSON object).\n'
         '    static func source(info: String) -> String {\n'
         '        js.replacingOccurrences(of: "/*HOST_INFO*/null", with: info)\n'
         '    }\n\n'
         '    static let js = #"""\n' + js + '"""#\n'
         '}\n')
old = open(out, encoding='utf-8').read() if os.path.exists(out) else None
if old != swift:
    open(out, 'w', encoding='utf-8').write(swift)
    print('BridgeScript.swift updated')
else:
    print('BridgeScript.swift up to date')
if '--check' in sys.argv and old != swift:
    sys.exit('BridgeScript.swift was out of date with bridge.js')
