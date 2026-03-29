import Foundation
import Combine

class AppState: ObservableObject {
    @Published var activeNotes: Set<Int> = []
    @Published var detectedChord: String = "—"

    private var audioEngine: AudioEngine?
    private var midiEngine: MIDIEngine?
    private var cancellables = Set<AnyCancellable>()

    init() {
        audioEngine = AudioEngine()
        midiEngine = MIDIEngine(appState: self)

        $activeNotes
            .map { ChordDetector.detect(notes: $0) }
            .receive(on: DispatchQueue.main)
            .assign(to: \.detectedChord, on: self)
            .store(in: &cancellables)
    }

    // Called from MIDIEngine (background thread) — dispatches to main
    func noteOn(_ note: Int, velocity: Int) {
        audioEngine?.noteOn(note: note, velocity: velocity)
        DispatchQueue.main.async {
            self.activeNotes.insert(note)
        }
    }

    func noteOff(_ note: Int) {
        audioEngine?.noteOff(note: note)
        DispatchQueue.main.async {
            self.activeNotes.remove(note)
        }
    }

    func allNotesOff() {
        audioEngine?.allNotesOff()
        DispatchQueue.main.async {
            self.activeNotes.removeAll()
        }
    }
}
