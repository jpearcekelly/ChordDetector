import { useState, useEffect, useCallback, useRef } from "react";
import Keyboard from "./components/Keyboard";
import { detectChord, noteName } from "./lib/chordDetector";
import { initMIDI, type MIDIStatus } from "./lib/midiEngine";
import { detectKey, noteNamesForKey, formatKey, allKeys, romanNumeral, type Key } from "./lib/keyDetector";
import * as audio from "./lib/audioEngine";
import "./App.css";

const ALL_KEYS = allKeys();

export default function App() {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [midiStatus, setMidiStatus] = useState<MIDIStatus>({ state: "pending" });

  // Key detection state
  const [keyMode, setKeyMode] = useState<"auto" | Key>("auto");
  const [detectedKey, setDetectedKey] = useState<Key | null>(null);
  const [keyConfidence, setKeyConfidence] = useState(0);
  const histogramRef = useRef<number[]>(new Array(12).fill(0));
  const decayTimerRef = useRef<number | null>(null);

  // Feature toggles
  const [showRomanNumerals, setShowRomanNumerals] = useState(false);
  const [latchMode, setLatchMode] = useState(false);

  // Track sustain pedal state and which notes are being sustained
  const sustainRef = useRef(false);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const sustainedNotesRef = useRef<Set<number>>(new Set());

  // Latch mode refs (need refs so callbacks don't go stale)
  const latchRef = useRef(false);
  latchRef.current = latchMode;

  // The active key: manual override or auto-detected
  const activeKey = keyMode === "auto" ? detectedKey : keyMode;
  const noteNames = noteNamesForKey(activeKey);

  // Update pitch class histogram when notes change
  const runDetection = useCallback(() => {
    const result = detectKey(histogramRef.current);
    if (result) {
      setDetectedKey(result.key);
      setKeyConfidence(result.confidence);
    }
  }, []);

  const updateHistogram = useCallback((note: number) => {
    const pc = note % 12;
    histogramRef.current[pc] += 1;

    // Gentle per-note decay: other pitch classes fade slightly
    histogramRef.current = histogramRef.current.map((v, i) =>
      i === pc ? v : v * 0.97,
    );

    runDetection();

    // Idle decay: when you stop playing, histogram fades
    if (decayTimerRef.current) clearTimeout(decayTimerRef.current);
    decayTimerRef.current = window.setTimeout(() => {
      histogramRef.current = histogramRef.current.map((v) => v * 0.75);
      runDetection();
    }, 3000);
  }, [runDetection]);

  const handleNoteOn = useCallback((note: number, velocity: number = 100) => {
    // In latch mode, playing a note that's already held toggles it off
    if (latchRef.current) {
      setActiveNotes((prev) => {
        if (prev.has(note)) {
          audio.noteOff(note);
          const next = new Set(prev);
          next.delete(note);
          return next;
        }
        audio.noteOn(note, velocity);
        return new Set(prev).add(note);
      });
    } else {
      audio.noteOn(note, velocity);
      setActiveNotes((prev) => new Set(prev).add(note));
    }
    heldNotesRef.current.add(note);
    sustainedNotesRef.current.delete(note);
    updateHistogram(note);
  }, [updateHistogram]);

  const handleNoteOff = useCallback((note: number) => {
    heldNotesRef.current.delete(note);

    // In latch mode, don't release notes
    if (latchRef.current) return;

    if (sustainRef.current) {
      sustainedNotesRef.current.add(note);
    } else {
      audio.noteOff(note);
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    }
  }, []);

  const handleSustainOn = useCallback(() => {
    sustainRef.current = true;
  }, []);

  const handleSustainOff = useCallback(() => {
    sustainRef.current = false;
    if (latchRef.current) return;
    for (const note of sustainedNotesRef.current) {
      audio.noteOff(note);
    }
    sustainedNotesRef.current.clear();
    setActiveNotes(new Set(heldNotesRef.current));
  }, []);

  const handleAllNotesOff = useCallback(() => {
    audio.allNotesOff();
    heldNotesRef.current.clear();
    sustainedNotesRef.current.clear();
    sustainRef.current = false;
    setActiveNotes(new Set());
  }, []);

  // Clear latched notes
  const clearLatch = useCallback(() => {
    audio.allNotesOff();
    sustainedNotesRef.current.clear();
    setActiveNotes(new Set(heldNotesRef.current));
  }, []);

  useEffect(() => {
    initMIDI(
      {
        noteOn: handleNoteOn,
        noteOff: handleNoteOff,
        allNotesOff: handleAllNotesOff,
        sustainOn: handleSustainOn,
        sustainOff: handleSustainOff,
      },
      setMidiStatus,
    );
  }, [handleNoteOn, handleNoteOff, handleAllNotesOff, handleSustainOn, handleSustainOff]);

  const chord = detectChord(activeNotes, noteNames);
  const sortedNotes = [...activeNotes].sort((a, b) => a - b);
  const hasNotes = activeNotes.size > 0;

  // Roman numeral for the current chord
  const roman = showRomanNumerals && activeKey && chord.root >= 0
    ? romanNumeral(chord.root, chord.suffix, activeKey)
    : null;

  return (
    <div className="app">
      <div className="chord-display">
        <h1 className={`chord-name ${hasNotes ? (chord.exact ? "active" : "uncertain") : ""}`}>
          {chord.name}
        </h1>
        {roman && (
          <div className="roman-numeral">{roman}</div>
        )}
        {hasNotes && chord.alternatives.length > 0 && (
          <div className="alternatives">
            {chord.alternatives.map((alt) => (
              <span key={alt} className="alt-chord">{alt}</span>
            ))}
          </div>
        )}
        <div className="note-pills">
          {sortedNotes.map((note) => (
            <span key={note} className="pill">
              {noteName(note, noteNames)}
            </span>
          ))}
        </div>
      </div>

      <div className="keyboard-area">
        <Keyboard
          activeNotes={activeNotes}
          onNoteOn={(n) => handleNoteOn(n)}
          onNoteOff={handleNoteOff}
        />
      </div>

      <div className="status-bar">
        <span className="status-left">
          {midiStatus.state === "connected" && midiStatus.deviceCount > 0 && (
            <span className="status connected">
              MIDI connected ({midiStatus.deviceCount} device{midiStatus.deviceCount > 1 ? "s" : ""})
            </span>
          )}
          {midiStatus.state === "connected" && midiStatus.deviceCount === 0 && (
            <span className="status waiting">No MIDI devices — click the keyboard above</span>
          )}
          {midiStatus.state === "unsupported" && (
            <span className="status unsupported">
              Web MIDI not supported — click the keyboard above (try Chrome for MIDI)
            </span>
          )}
          {midiStatus.state === "denied" && (
            <span className="status denied">MIDI access denied</span>
          )}
          {midiStatus.state === "pending" && (
            <span className="status pending">Connecting to MIDI…</span>
          )}
        </span>

        <div className="toolbar">
          <button
            className={`tool-btn ${showRomanNumerals ? "active" : ""}`}
            onClick={() => setShowRomanNumerals((v) => !v)}
            title="Show Roman numeral analysis"
          >
            IV
          </button>
          <button
            className={`tool-btn ${latchMode ? "active" : ""}`}
            onClick={() => {
              setLatchMode((v) => {
                if (v) clearLatch(); // turning off — release latched notes
                return !v;
              });
            }}
            title="Latch mode — notes stay held"
          >
            Hold
          </button>

          <div className="key-selector">
            <label htmlFor="key-select">Key:</label>
            {keyMode === "auto" && detectedKey && (
              <button
                className="tool-btn lock-btn"
                onClick={() => setKeyMode(detectedKey)}
                title={`Lock key to ${formatKey(detectedKey)}`}
              >
                Lock
              </button>
            )}
            {keyMode !== "auto" && (
              <button
                className="tool-btn lock-btn active"
                onClick={() => setKeyMode("auto")}
                title="Unlock — return to auto-detect"
              >
                Unlock
              </button>
            )}
            <div className="key-select-wrapper">
              <select
                id="key-select"
                value={keyMode === "auto" ? "auto" : `${keyMode.tonic}-${keyMode.mode}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "auto") {
                    setKeyMode("auto");
                  } else {
                    const [tonic, mode] = val.split("-");
                    setKeyMode({ tonic: Number(tonic), mode: mode as "major" | "minor" });
                  }
                }}
              >
                <option value="auto">
                  Auto{detectedKey ? ` · ${formatKey(detectedKey)}` : ""}
                </option>
                <optgroup label="Major">
                  {ALL_KEYS.filter((k) => k.mode === "major").map((k) => (
                    <option key={`${k.tonic}-${k.mode}`} value={`${k.tonic}-${k.mode}`}>
                      {formatKey(k)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Minor">
                  {ALL_KEYS.filter((k) => k.mode === "minor").map((k) => (
                    <option key={`${k.tonic}-${k.mode}`} value={`${k.tonic}-${k.mode}`}>
                      {formatKey(k)}
                    </option>
                  ))}
                </optgroup>
              </select>
              {keyMode === "auto" && (
                <div className="key-confidence-bar">
                  <div
                    className="key-confidence-fill"
                    style={{
                      width: `${Math.round(keyConfidence * 100)}%`,
                      backgroundColor: keyConfidence > 0.3
                        ? `hsl(${120 + keyConfidence * 120}, 60%, 50%)`
                        : "rgba(255, 255, 255, 0.2)",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
