import Foundation

enum ChordDetector {
    private static let noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    // Each entry: (interval pattern from root, chord suffix)
    // Ordered from most to least common so we match the "best" name first
    private static let chordPatterns: [(pattern: [Int], suffix: String)] = [
        // Triads
        ([0, 4, 7],       ""),        // Major
        ([0, 3, 7],       "m"),       // Minor
        ([0, 3, 6],       "dim"),     // Diminished
        ([0, 4, 8],       "aug"),     // Augmented
        ([0, 2, 7],       "sus2"),    // Suspended 2nd
        ([0, 5, 7],       "sus4"),    // Suspended 4th
        ([0, 7],          "5"),       // Power chord

        // Seventh chords
        ([0, 4, 7, 11],   "maj7"),    // Major 7th
        ([0, 3, 7, 10],   "m7"),      // Minor 7th
        ([0, 4, 7, 10],   "7"),       // Dominant 7th
        ([0, 3, 6, 10],   "m7b5"),    // Half-diminished (ø7)
        ([0, 3, 6, 9],    "dim7"),    // Fully diminished 7th
        ([0, 4, 8, 10],   "aug7"),    // Augmented 7th
        ([0, 4, 8, 11],   "augmaj7"), // Augmented major 7th

        // Sixth chords
        ([0, 4, 7, 9],    "6"),       // Major 6th
        ([0, 3, 7, 9],    "m6"),      // Minor 6th

        // Extended chords
        ([0, 4, 7, 11, 14], "maj9"),  // Major 9th
        ([0, 4, 7, 10, 14], "9"),     // Dominant 9th
        ([0, 3, 7, 10, 14], "m9"),    // Minor 9th

        // Add chords
        ([0, 2, 4, 7],    "add9"),    // Add 9
        ([0, 4, 5, 7],    "add11"),   // Add 11
    ]

    /// Returns a chord name (e.g. "Cmaj7") for the given set of active MIDI note numbers.
    static func detect(notes: Set<Int>) -> String {
        guard !notes.isEmpty else { return "—" }

        if notes.count == 1 {
            return noteNames[notes.first! % 12]
        }

        // Reduce to unique pitch classes (0–11) and sort
        let pitchClasses = Array(Set(notes.map { $0 % 12 })).sorted()

        // Try every pitch class as the root — pick the first exact match
        for root in pitchClasses {
            let intervals = pitchClasses
                .map { ($0 - root + 12) % 12 }
                .sorted()

            if let match = chordPatterns.first(where: { $0.pattern == intervals }) {
                return noteNames[root] + match.suffix
            }
        }

        // No exact match: show the note names so the user isn't left with nothing
        return pitchClasses.map { noteNames[$0] }.joined(separator: " ")
    }
}
