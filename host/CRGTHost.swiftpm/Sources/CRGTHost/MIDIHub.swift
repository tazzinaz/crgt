// The iPad's MIDI for CRGT: every source CoreMIDI lists (IDAM MIDI Host when a Mac has the iPad enabled in Audio MIDI
// Setup, USB and Bluetooth devices, Network Session 1 when Wi-Fi MIDI is on), a virtual "CRGT" destination other iPad
// apps can play into, and the destinations for MIDIOutput.send. Uses the MIDI 1.0 protocol through Universal MIDI
// Packets (UMP.swift does the conversion).
//
// Threads: CoreMIDI calls `receive` on its own high-priority thread; messages are collected under a lock and handed to
// the main thread in one batch (`onReceive`, a JSON array). Everything else runs on the main thread.

import Foundation
import CoreMIDI

final class MIDIHub: @unchecked Sendable {
    struct Endpoint {
        let ref: MIDIEndpointRef
        let uid: MIDIUniqueID
        let id: String
        let name: String
        let maker: String
    }

    /// A JSON array of [portId, byte, byte, ...] messages, on the main thread.
    var onReceive: ((String) -> Void)?
    /// The list of ports (or the network session) changed, on the main thread.
    var onChange: (() -> Void)?

    private(set) var running = false
    private(set) var status: OSStatus = noErr
    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var virtualDest = MIDIEndpointRef()
    private var connected: [MIDIEndpointRef: MIDIUniqueID] = [:]
    private(set) var sources: [Endpoint] = []
    private(set) var destinations: [Endpoint] = []

    private let lock = NSLock()
    private var pending: [(String, [UInt8])] = []
    private var flushQueued = false
    private var sysex: [UInt: [UInt8]] = [:]

    static let virtualTag: UInt = 1 << 40
    static let virtualID = "crgt"
    static let virtualName = "CRGT (other iPad apps)"
    private static let wordsOffset = MemoryLayout<MIDIEventPacket>.offset(of: \MIDIEventPacket.words) ?? 12
    private static let timebase: mach_timebase_info_data_t = {
        var t = mach_timebase_info_data_t()
        mach_timebase_info(&t)
        return t
    }()

    var hasVirtual: Bool { virtualDest != 0 }

    // MARK: start

    /// Starts CoreMIDI once; later calls only answer. Returns noErr or the CoreMIDI error.
    @discardableResult
    func start() -> OSStatus {
        if running { return noErr }
        var st = MIDIClientCreateWithBlock("CRGT Host" as CFString, &client) { [weak self] note in
            if note.pointee.messageID == .msgSetupChanged {
                DispatchQueue.main.async { self?.refresh() }
            }
        }
        guard st == noErr else { status = st; return st }
        st = MIDIInputPortCreateWithProtocol(client, "CRGT In" as CFString, ._1_0, &inPort) { [weak self] list, refCon in
            self?.receive(list, tag: UInt(bitPattern: refCon))
        }
        guard st == noErr else { status = st; return st }
        st = MIDIOutputPortCreate(client, "CRGT Out" as CFString, &outPort)
        guard st == noErr else { status = st; return st }
        makeVirtual()
        running = true
        status = noErr
        refresh()
        return noErr
    }

    /// The "CRGT" destination other apps see. iOS allows it only to apps with the audio background mode (Info.plist);
    /// without it this simply does not appear.
    private func makeVirtual() {
        var dest = MIDIEndpointRef()
        let st = MIDIDestinationCreateWithProtocol(client, "CRGT" as CFString, ._1_0, &dest) { [weak self] list, _ in
            self?.receive(list, tag: MIDIHub.virtualTag)
        }
        guard st == noErr, dest != 0 else { return }
        virtualDest = dest
        // keep the same unique ID across launches, so other apps remember the connection
        let key = "crgt.virtualUID"
        let saved = MIDIUniqueID(truncatingIfNeeded: UserDefaults.standard.integer(forKey: key))
        if saved != 0, MIDIObjectSetIntegerProperty(dest, kMIDIPropertyUniqueID, saved) == noErr { return }
        var uid = MIDIUniqueID()
        if MIDIObjectGetIntegerProperty(dest, kMIDIPropertyUniqueID, &uid) == noErr {
            UserDefaults.standard.set(Int(uid), forKey: key)
        }
    }

    // MARK: ports

    /// Connects every source, lists the destinations, and tells the page.
    func refresh() {
        guard running else { return }
        var now: [MIDIEndpointRef: MIDIUniqueID] = [:]
        var list: [Endpoint] = []
        for i in 0..<MIDIGetNumberOfSources() {
            let e = MIDIGetSource(i)
            if e == 0 || Self.offline(e) { continue }
            let uid = Self.uniqueID(e)
            now[e] = uid
            list.append(Endpoint(ref: e, uid: uid, id: "i\(uid)", name: Self.name(e), maker: Self.string(e, kMIDIPropertyManufacturer)))
        }
        for (e, _) in connected where now[e] == nil { MIDIPortDisconnectSource(inPort, e) }
        for (e, uid) in now where connected[e] != uid {
            if connected[e] != nil { MIDIPortDisconnectSource(inPort, e) }
            MIDIPortConnectSource(inPort, e, UnsafeMutableRawPointer(bitPattern: Self.tag(uid)))
        }
        connected = now
        sources = list
        var dests: [Endpoint] = []
        for i in 0..<MIDIGetNumberOfDestinations() {
            let e = MIDIGetDestination(i)
            if e == 0 || e == virtualDest || Self.offline(e) { continue }
            let uid = Self.uniqueID(e)
            dests.append(Endpoint(ref: e, uid: uid, id: "o\(uid)", name: Self.name(e), maker: Self.string(e, kMIDIPropertyManufacturer)))
        }
        destinations = dests
        onChange?()
    }

    /// The ports, as the page's Web MIDI bridge wants them.
    func ports() -> [[String: Any]] {
        var out: [[String: Any]] = []
        for s in sources { out.append(["id": s.id, "type": "input", "name": s.name, "manufacturer": s.maker]) }
        if hasVirtual { out.append(["id": Self.virtualID, "type": "input", "name": Self.virtualName, "manufacturer": "CRGT Host"]) }
        for d in destinations { out.append(["id": d.id, "type": "output", "name": d.name, "manufacturer": d.maker]) }
        return out
    }

    // MARK: in

    private static func tag(_ uid: MIDIUniqueID) -> UInt { UInt(UInt32(bitPattern: uid)) + 1 }

    private static func portID(_ tag: UInt) -> String {
        if tag == virtualTag { return virtualID }
        let uid = Int32(bitPattern: UInt32(truncatingIfNeeded: tag &- 1))
        return "i\(uid)"
    }

    private func receive(_ list: UnsafePointer<MIDIEventList>, tag: UInt) {
        var msgs: [[UInt8]] = []
        lock.lock()
        var sx = sysex[tag] ?? []
        for pkt in list.unsafeSequence() {
            let count = min(Int(pkt.pointee.wordCount), 64)
            let words = UnsafeRawPointer(pkt).advanced(by: Self.wordsOffset).assumingMemoryBound(to: UInt32.self)
            UMP.decode(UnsafeBufferPointer(start: words, count: count), sysex: &sx, into: &msgs)
        }
        sysex[tag] = sx.isEmpty ? nil : sx
        if !msgs.isEmpty {
            let id = Self.portID(tag)
            for m in msgs { pending.append((id, m)) }
            if !flushQueued {
                flushQueued = true
                DispatchQueue.main.async { [weak self] in self?.flush() }
            }
        }
        lock.unlock()
    }

    private func flush() {
        lock.lock()
        let batch = pending
        pending.removeAll(keepingCapacity: true)
        flushQueued = false
        lock.unlock()
        guard !batch.isEmpty else { return }
        var s = "["
        s.reserveCapacity(batch.count * 20)
        for (k, (id, bytes)) in batch.enumerated() {
            if k > 0 { s += "," }
            s += "[\"" + id + "\""
            for b in bytes { s += "," + String(b) }
            s += "]"
        }
        s += "]"
        onReceive?(s)
    }

    // MARK: out

    /// Sends whole MIDI 1.0 messages to a destination, `delayMs` from now (0: at once).
    func send(id: String, bytes: [UInt8], delayMs: Double) {
        guard running, let dest = destinations.first(where: { $0.id == id })?.ref else { return }
        let words = UMP.encode(bytes)
        guard !words.isEmpty else { return }
        var when: MIDITimeStamp = 0
        if delayMs > 0.5 {
            let tb = Self.timebase
            when = mach_absolute_time() + UInt64(delayMs * 1_000_000 * Double(tb.denom) / Double(tb.numer))
        }
        let size = MemoryLayout<MIDIEventList>.size + words.count * 8 + 256
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 8)
        defer { raw.deallocate() }
        let list = raw.bindMemory(to: MIDIEventList.self, capacity: 1)
        var packet: UnsafeMutablePointer<MIDIEventPacket>? = MIDIEventListInit(list, ._1_0)
        words.withUnsafeBufferPointer { w in
            var i = 0
            while i < w.count, let p = packet, let base = w.baseAddress {
                let n = min(UMP.size(of: w[i]), w.count - i)
                packet = MIDIEventListAdd(list, size, p, when, n, base + i)
                i += n
            }
        }
        MIDISendEventList(outPort, dest, list)
    }

    // MARK: Wi-Fi (Apple's network session, which a Mac joins from Audio MIDI Setup)

    private static let networkKey = "crgt.network"

    func restoreNetwork() {
        if UserDefaults.standard.bool(forKey: Self.networkKey) { setNetwork(true) }
    }

    func setNetwork(_ on: Bool) {
        let s = MIDINetworkSession.default()
        s.isEnabled = on
        s.connectionPolicy = on ? .anyone : .noOne
        UserDefaults.standard.set(on, forKey: Self.networkKey)
    }

    func networkInfo() -> [String: Any] {
        let s = MIDINetworkSession.default()
        let peers = s.connections().map { $0.host.name }.sorted()
        return ["on": s.isEnabled, "name": s.networkName, "local": s.localName, "peers": peers]
    }

    // MARK: properties

    private static func offline(_ e: MIDIObjectRef) -> Bool {
        var v: Int32 = 0
        return MIDIObjectGetIntegerProperty(e, kMIDIPropertyOffline, &v) == noErr && v != 0
    }

    private static func uniqueID(_ e: MIDIObjectRef) -> MIDIUniqueID {
        var v = MIDIUniqueID()
        _ = MIDIObjectGetIntegerProperty(e, kMIDIPropertyUniqueID, &v)
        return v
    }

    private static func string(_ e: MIDIObjectRef, _ key: CFString) -> String {
        var s: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(e, key, &s) == noErr, let v = s?.takeRetainedValue() else { return "" }
        return v as String
    }

    private static func name(_ e: MIDIObjectRef) -> String {
        let d = string(e, kMIDIPropertyDisplayName)
        if !d.isEmpty { return d }
        let n = string(e, kMIDIPropertyName)
        return n.isEmpty ? "MIDI" : n
    }
}
