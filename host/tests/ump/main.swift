// Round trips for UMP.swift, run on the Mac by CI:
//   swiftc host/CRGTHost.swiftpm/Sources/CRGTHost/UMP.swift host/tests/ump/main.swift -o /tmp/ump && /tmp/ump
var failed = 0, passed = 0
func check(_ ok: Bool, _ what: String) {
    if ok { passed += 1 } else { failed += 1; print("FAIL: \(what)") }
}
func hex(_ m: [[UInt8]]) -> String { m.map { $0.map { String($0, radix: 16) }.joined(separator: " ") }.joined(separator: " | ") }

// one message each way
let cases: [[UInt8]] = [
    [0x90, 60, 100], [0x80, 60, 0], [0x9F, 127, 1], [0xB0, 64, 127], [0xB3, 1, 0], [0xC5, 12], [0xD0, 99],
    [0xE0, 0x00, 0x40], [0xE7, 0x7F, 0x7F], [0xA1, 61, 30],
    [0xF8], [0xFA], [0xFB], [0xFC], [0xFE], [0xFF], [0xF6], [0xF1, 0x23], [0xF2, 0x10, 0x05], [0xF3, 7],
    [0xF0, 0xF7], [0xF0, 0x7E, 0xF7], [0xF0, 1, 2, 3, 4, 5, 6, 0xF7], [0xF0, 1, 2, 3, 4, 5, 6, 7, 0xF7],
    [0xF0] + (0..<100).map { UInt8($0) } + [0xF7],
]
for c in cases {
    var sx: [UInt8] = []
    let w = UMP.encode(c)
    let back = UMP.decode(w, sysex: &sx)
    check(back == [c], "round trip \(hex([c])) -> \(hex(back))")
    check(sx.isEmpty, "sysex buffer empty after \(hex([c]))")
}

// word layout
check(UMP.encode([0x90, 60, 100]) == [0x2090_3C64], "note on word")
check(UMP.encode([0xC5, 12]) == [0x20C5_0C00], "program change word")
check(UMP.encode([0xF8]) == [0x10F8_0000], "clock word")
check(UMP.encode([0xF0, 0x7E, 0x7F, 0xF7]) == [0x3002_7E7F, 0], "short sysex words")

// several messages in one send, stray bytes skipped, data bytes kept to 7 bits
var sx0: [UInt8] = []
check(UMP.decode(UMP.encode([0x90, 60, 100, 0x40, 0x80, 60, 0, 0xF8]), sysex: &sx0) == [[0x90, 60, 100], [0x80, 60, 0], [0xF8]], "stream with a stray byte")
check(UMP.encode([0x90, 0x3C, 0xE4]) == [0x2090_3C64], "data byte kept to 7 bits")

// a long sysex split across two packet lists (as CoreMIDI can deliver it)
let long: [UInt8] = [0xF0] + (0..<40).map { UInt8($0 % 128) } + [0xF7]
let lw = UMP.encode(long)
var sx: [UInt8] = []
let first = UMP.decode(Array(lw[0..<6]), sysex: &sx)
check(first.isEmpty && !sx.isEmpty, "first half keeps the sysex open")
let rest = UMP.decode(Array(lw[6...]), sysex: &sx)
check(rest == [long], "second half completes the sysex")
check(sx.isEmpty, "buffer clear after the sysex")

// MIDI 2.0 / utility words in the list are skipped, sizes respected
var sx2: [UInt8] = []
let mixed: [UInt32] = [0x0000_0000, 0x4090_3C00, 0xFFFF_0000, 0x2090_3C64, 0xF000_0000, 0, 0, 0, 0x10F8_0000]
check(UMP.decode(mixed, sysex: &sx2) == [[0x90, 60, 100], [0xF8]], "skips utility, MIDI 2.0 and stream words")
// a cut-off message at the end of a list is not read past the end
check(UMP.decode([0x3016_0102], sysex: &sx2).isEmpty, "half a sysex packet is ignored")

print("UMP: \(passed) passed, \(failed) failed")
if failed > 0 { fatalError("UMP tests failed") }
