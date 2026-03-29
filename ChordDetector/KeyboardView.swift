import SwiftUI

struct KeyboardView: View {
    let activeNotes: Set<Int>

    // Display C3 (MIDI 48) through C7 (MIDI 96) = 4 octaves
    private let startOctave = 3
    private let numOctaves = 4

    // Pitch classes of white keys within an octave: C D E F G A B
    private let whiteKeyPitches = [0, 2, 4, 5, 7, 9, 11]

    // Black key pitch class + its fractional white-key x position within an octave
    // e.g. C# sits 0.7 white-key-widths from the start of the octave
    private let blackKeys: [(pitch: Int, xFrac: CGFloat)] = [
        (1, 0.70),   // C#
        (3, 1.70),   // D#
        (6, 3.70),   // F#
        (8, 4.70),   // G#
        (10, 5.70),  // A#
    ]

    var body: some View {
        Canvas { context, size in
            let totalWhiteKeys = numOctaves * 7 + 1  // includes final C7
            let wkw = size.width / CGFloat(totalWhiteKeys)
            let wkh = size.height
            let bkw = wkw * 0.62
            let bkh = wkh * 0.62

            // ── White keys ──────────────────────────────
            for i in 0..<totalWhiteKeys {
                let midi = midiForWhiteIndex(i)
                let isActive = activeNotes.contains(midi)
                let x = CGFloat(i) * wkw
                let rect = CGRect(x: x + 0.5, y: 0.5, width: wkw - 1, height: wkh - 1)

                context.fill(
                    Path(roundedRect: rect, cornerRadius: 4),
                    with: .color(isActive ? .blue.opacity(0.55) : .white)
                )
                context.stroke(
                    Path(roundedRect: rect, cornerRadius: 4),
                    with: .color(.gray.opacity(0.35)),
                    lineWidth: 0.5
                )

                // Note label on bottom of white key (C notes only)
                if midi % 12 == 0 {
                    let label = "C\(midi / 12 - 1)"
                    var text = Text(label).font(.system(size: 9, weight: .medium))
                    if isActive { text = text.foregroundColor(.white) } else { text = text.foregroundColor(.gray) }
                    context.draw(
                        text,
                        at: CGPoint(x: x + wkw / 2, y: wkh - 10),
                        anchor: .center
                    )
                }
            }

            // ── Black keys ───────────────────────────────
            for octave in 0..<numOctaves {
                for bk in blackKeys {
                    let midi = (startOctave + octave) * 12 + bk.pitch
                    let isActive = activeNotes.contains(midi)
                    let x = (CGFloat(octave * 7) + bk.xFrac) * wkw - bkw / 2
                    let rect = CGRect(x: x, y: 0, width: bkw, height: bkh)

                    context.fill(
                        Path(roundedRect: rect, cornerRadius: 3),
                        with: .color(isActive ? .blue : .black)
                    )
                }
            }
        }
        .background(Color(.windowBackgroundColor).opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
    }

    // Maps a sequential white-key index (0 = C3, 1 = D3, …) to a MIDI note number
    private func midiForWhiteIndex(_ i: Int) -> Int {
        let octave = i / 7
        if octave >= numOctaves { return (startOctave + numOctaves) * 12 }
        return (startOctave + octave) * 12 + whiteKeyPitches[i % 7]
    }
}

#Preview {
    KeyboardView(activeNotes: [60, 64, 67])  // C major
        .frame(width: 900, height: 160)
        .padding()
}
