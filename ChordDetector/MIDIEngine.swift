import CoreMIDI
import Foundation

// C-compatible callback — cannot capture context, so we pass `self` via refCon
private func midiReadCallback(
    _ packetList: UnsafePointer<MIDIPacketList>,
    _ readProcRefCon: UnsafeMutableRawPointer?,
    _ srcConnRefCon: UnsafeMutableRawPointer?
) {
    guard let refCon = readProcRefCon else { return }
    let engine = Unmanaged<MIDIEngine>.fromOpaque(refCon).takeUnretainedValue()
    engine.handlePacketList(packetList)
}

class MIDIEngine {
    private var client: MIDIClientRef = 0
    private var inputPort: MIDIPortRef = 0
    private weak var appState: AppState?

    init(appState: AppState) {
        self.appState = appState
        setupMIDI()
    }

    private func setupMIDI() {
        // Notification fires when MIDI devices are added/removed
        let notifyProc: MIDINotifyProc = { notification, refCon in
            guard let refCon = refCon else { return }
            let engine = Unmanaged<MIDIEngine>.fromOpaque(refCon).takeUnretainedValue()
            if notification.pointee.messageID == .msgSetupChanged {
                engine.connectAllSources()
            }
        }

        MIDIClientCreate(
            "ChordDetector" as CFString,
            notifyProc,
            Unmanaged.passUnretained(self).toOpaque(),
            &client
        )

        MIDIInputPortCreate(
            client,
            "ChordDetectorInput" as CFString,
            midiReadCallback,
            Unmanaged.passUnretained(self).toOpaque(),
            &inputPort
        )

        connectAllSources()
    }

    func connectAllSources() {
        let count = MIDIGetNumberOfSources()
        for i in 0..<count {
            let source = MIDIGetSource(i)
            MIDIPortConnectSource(inputPort, source, nil)
        }
    }

    func handlePacketList(_ packetList: UnsafePointer<MIDIPacketList>) {
        var packet = packetList.pointee.packet
        for _ in 0..<packetList.pointee.numPackets {
            handlePacket(&packet)
            packet = MIDIPacketNext(&packet).pointee
        }
    }

    private func handlePacket(_ packet: inout MIDIPacket) {
        let length = Int(packet.length)
        guard length >= 1 else { return }

        // packet.data is a 256-byte tuple — read it as a byte buffer
        let bytes: [UInt8] = withUnsafeBytes(of: &packet.data) {
            Array($0.prefix(length))
        }

        let status = bytes[0] & 0xF0
        let channel = bytes[0] & 0x0F  // available if needed later

        switch status {
        case 0x90 where length >= 3 && bytes[2] > 0:
            // Note On (velocity > 0)
            appState?.noteOn(Int(bytes[1]), velocity: Int(bytes[2]))
        case 0x80, 0x90 where length >= 2:
            // Note Off OR Note On with velocity 0 (common shorthand)
            appState?.noteOff(Int(bytes[1]))
        case 0xB0 where length >= 3 && bytes[1] == 123:
            // CC 123 = All Notes Off
            appState?.allNotesOff()
        default:
            break
        }
        _ = channel // suppress unused warning
    }
}
