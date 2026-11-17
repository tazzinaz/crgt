// Universal MIDI Packet words <-> MIDI 1.0 bytes, for CoreMIDI's MIDI 1.0 protocol: system messages (type 1),
// channel voice messages (type 2) and system exclusive in 7-bit packets (type 3). Pure Swift, no CoreMIDI, so it can be
// tested on its own (host/tests/ump).

enum UMP {
    /// Words in the UMP message that starts with `word`, from its message type.
    static func size(of word: UInt32) -> Int {
        switch word >> 28 {
        case 0x0, 0x1, 0x2, 0x6, 0x7: return 1
        case 0x3, 0x4, 0x8, 0x9, 0xA: return 2
        case 0xB, 0xC: return 3
        default: return 4
        }
    }

    /// A system exclusive message longer than this is dropped rather than kept growing.
    static let sysexLimit = 1 << 16

    /// The MIDI 1.0 messages in `words`, appended to `out`. `sysex` carries a system exclusive message that spans
    /// several packets (and several calls); keep one per source.
    static func decode(_ words: UnsafeBufferPointer<UInt32>, sysex: inout [UInt8], into out: inout [[UInt8]]) {
        var i = 0
        let n = words.count
        while i < n {
            let w = words[i]
            let len = size(of: w)
            if i + len > n { break }
            let st = UInt8(truncatingIfNeeded: w >> 16)
            let d1 = UInt8(truncatingIfNeeded: w >> 8) & 0x7F
            let d2 = UInt8(truncatingIfNeeded: w) & 0x7F
            switch w >> 28 {
            case 0x1:
                switch st {
                case 0xF1, 0xF3: out.append([st, d1])
                case 0xF2: out.append([st, d1, d2])
                case 0xF6, 0xF8...0xFF: out.append([st])
                default: break
                }
            case 0x2:
                if st >= 0x80 && st < 0xF0 {
                    let hi = st & 0xF0
                    out.append(hi == 0xC0 || hi == 0xD0 ? [st, d1] : [st, d1, d2])
                }
            case 0x3:
                let status = (w >> 20) & 0xF
                let count = min(Int((w >> 16) & 0xF), 6)
                let w2 = words[i + 1]
                let all: [UInt8] = [d1, d2,
                                    UInt8(truncatingIfNeeded: w2 >> 24) & 0x7F,
                                    UInt8(truncatingIfNeeded: w2 >> 16) & 0x7F,
                                    UInt8(truncatingIfNeeded: w2 >> 8) & 0x7F,
                                    UInt8(truncatingIfNeeded: w2) & 0x7F]
                let data = all[0..<count]
                switch status {
                case 0:
                    sysex.removeAll()
                    var m: [UInt8] = [0xF0]
                    m += data
                    m.append(0xF7)
                    out.append(m)
                case 1:
                    sysex = [0xF0]
                    sysex += data
                case 2:
                    if !sysex.isEmpty {
                        sysex += data
                        if sysex.count > sysexLimit { sysex.removeAll() }
                    }
                case 3:
                    if !sysex.isEmpty {
                        sysex += data
                        sysex.append(0xF7)
                        out.append(sysex)
                        sysex.removeAll()
                    }
                default: break
                }
            default: break
            }
            i += len
        }
    }

    /// Convenience for arrays (tests).
    static func decode(_ words: [UInt32], sysex: inout [UInt8]) -> [[UInt8]] {
        var out: [[UInt8]] = []
        words.withUnsafeBufferPointer { decode($0, sysex: &sysex, into: &out) }
        return out
    }

    /// UMP words (MIDI 1.0 protocol, group 0) for a run of whole MIDI 1.0 messages. Stray data bytes are skipped.
    static func encode(_ b: [UInt8]) -> [UInt32] {
        var out: [UInt32] = []
        var i = 0
        let n = b.count
        func data(_ k: Int) -> UInt32 { k < n ? UInt32(b[k] & 0x7F) : 0 }
        while i < n {
            let st = b[i]
            if st < 0x80 || st == 0xF7 { i += 1; continue }
            if st == 0xF0 {
                var j = i + 1
                var body: [UInt8] = []
                while j < n && b[j] < 0x80 { body.append(b[j]); j += 1 }
                if j < n && b[j] == 0xF7 { j += 1 }
                out += sysexWords(body)
                i = j
                continue
            }
            let s = UInt32(st)
            if st >= 0xF0 {
                let len = (st == 0xF1 || st == 0xF3) ? 1 : (st == 0xF2 ? 2 : 0)
                var w: UInt32 = 0x1000_0000 | s << 16
                if len >= 1 { w |= data(i + 1) << 8 }
                if len == 2 { w |= data(i + 2) }
                out.append(w)
                i += 1 + len
                continue
            }
            let hi = st & 0xF0
            let len = (hi == 0xC0 || hi == 0xD0) ? 1 : 2
            var w: UInt32 = 0x2000_0000 | s << 16 | data(i + 1) << 8
            if len == 2 { w |= data(i + 2) }
            out.append(w)
            i += 1 + len
        }
        return out
    }

    /// System exclusive data (without F0 and F7) as 7-bit packets of up to six bytes each.
    static func sysexWords(_ body: [UInt8]) -> [UInt32] {
        var out: [UInt32] = []
        let chunks = max(1, (body.count + 5) / 6)
        for c in 0..<chunks {
            let start = c * 6
            let end = min(start + 6, body.count)
            let status: UInt32 = chunks == 1 ? 0 : (c == 0 ? 1 : (c == chunks - 1 ? 3 : 2))
            var w0: UInt32 = 0x3000_0000 | status << 20 | UInt32(end - start) << 16
            var w1: UInt32 = 0
            var k = start
            while k < end {
                let v = UInt32(body[k] & 0x7F)
                switch k - start {
                case 0: w0 |= v << 8
                case 1: w0 |= v
                case 2: w1 |= v << 24
                case 3: w1 |= v << 16
                case 4: w1 |= v << 8
                default: w1 |= v
                }
                k += 1
            }
            out.append(w0)
            out.append(w1)
        }
        return out
    }
}
