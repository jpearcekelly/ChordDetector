import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            chordDisplayArea
            Divider()
            keyboardArea
        }
        .frame(minWidth: 900, minHeight: 380)
        .background(Color(.windowBackgroundColor))
    }

    // ── Chord name + active note pills ─────────────────────────────────────────
    private var chordDisplayArea: some View {
        VStack(spacing: 12) {
            Text(appState.detectedChord)
                .font(.system(size: 100, weight: .bold, design: .rounded))
                .foregroundStyle(
                    appState.activeNotes.isEmpty
                        ? AnyShapeStyle(Color.secondary.opacity(0.3))
                        : AnyShapeStyle(LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .leading,
                            endPoint: .trailing
                        ))
                )
                .contentTransition(.numericText())
                .animation(.spring(response: 0.2, dampingFraction: 0.7), value: appState.detectedChord)

            // Active note pills
            HStack(spacing: 6) {
                ForEach(Array(appState.activeNotes).sorted(), id: \.self) { note in
                    Text(noteName(for: note))
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.blue.opacity(0.15))
                        .clipShape(Capsule())
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .frame(height: 24)
            .animation(.spring(response: 0.15), value: appState.activeNotes)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 32)
    }

    // ── Piano keyboard ──────────────────────────────────────────────────────────
    private var keyboardArea: some View {
        KeyboardView(activeNotes: appState.activeNotes)
            .frame(height: 160)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────
    private func noteName(for midi: Int) -> String {
        let names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
        let octave = (midi / 12) - 1
        return "\(names[midi % 12])\(octave)"
    }
}

#Preview {
    ContentView()
        .environmentObject({
            let s = AppState()
            s.activeNotes = [60, 64, 67]
            return s
        }())
}
