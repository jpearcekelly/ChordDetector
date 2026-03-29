import AVFoundation
import AudioToolbox

class AudioEngine {
    private let engine = AVAudioEngine()
    private var sampler: AVAudioUnitSampler?
    private var isReady = false

    init() {
        setupEngine()
    }

    private func setupEngine() {
        let sampler = AVAudioUnitSampler()
        self.sampler = sampler

        engine.attach(sampler)
        engine.connect(sampler, to: engine.mainMixerNode, format: nil)

        do {
            try engine.start()
        } catch {
            print("AudioEngine: failed to start — \(error)")
            return
        }

        loadPianoSounds(into: sampler)
    }

    private func loadPianoSounds(into sampler: AVAudioUnitSampler) {
        // Apple ships a General MIDI DLS soundfont with CoreAudio.
        // Program 0 = Acoustic Grand Piano in General MIDI.
        let candidatePaths = [
            "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls",
            "/Library/Audio/Sounds/Banks/gs_instruments.dls",
        ]

        for path in candidatePaths {
            let url = URL(fileURLWithPath: path)
            guard FileManager.default.fileExists(atPath: path) else { continue }

            do {
                // bankMSB 0x79 = melodic bank (kAUSampler_DefaultMelodicBankMSB)
                try sampler.loadSoundBankInstrument(
                    at: url,
                    program: 0,
                    bankMSB: 0x79,
                    bankLSB: 0x00
                )
                isReady = true
                print("AudioEngine: loaded piano from \(path)")
                return
            } catch {
                print("AudioEngine: failed to load \(path) — \(error)")
            }
        }

        // Fallback: sampler will still work but with no bank loaded (silent)
        print("AudioEngine: no DLS soundfont found — audio will be silent")
    }

    func noteOn(note: Int, velocity: Int) {
        sampler?.startNote(UInt8(clamping: note), withVelocity: UInt8(clamping: velocity), onChannel: 0)
    }

    func noteOff(note: Int) {
        sampler?.stopNote(UInt8(clamping: note), onChannel: 0)
    }

    func allNotesOff() {
        for note in 0..<128 {
            sampler?.stopNote(UInt8(note), onChannel: 0)
        }
    }
}
