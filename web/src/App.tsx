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
  const [lockedKey, setLockedKey] = useState<Key | null>(null); // auto-locked once confident
  const [keyConfidence, setKeyConfidence] = useState(0);
  const histogramRef = useRef<number[]>(new Array(12).fill(0));
  const decayTimerRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  // Feature toggles
  const [showRomanNumerals, setShowRomanNumerals] = useState(false);
  const [latchMode, setLatchMode] = useState(false);
  const [suggestMode, setSuggestMode] = useState(true);

  // Track sustain pedal state and which notes are being sustained
  const sustainRef = useRef(false);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const sustainedNotesRef = useRef<Set<number>>(new Set());

  // Latch mode refs (need refs so callbacks don't go stale)
  const latchRef = useRef(false);
  latchRef.current = latchMode;

  // Double-tap detection for auto-toggling latch mode
  const lastNoteTimeRef = useRef<{ note: number; time: number }>({ note: -1, time: 0 });
  const DOUBLE_TAP_MS = 300;

  // The active key: manual override > auto-locked > detecting
  const activeKey = keyMode !== "auto" ? keyMode : (lockedKey ?? detectedKey);
  const noteNames = noteNamesForKey(activeKey);

  // Key detection confidence threshold to auto-lock
  const LOCK_THRESHOLD = 0.25;

  // Update pitch class histogram when notes change
  const runDetection = useCallback(() => {
    const result = detectKey(histogramRef.current);
    if (result) {
      setDetectedKey(result.key);
      setKeyConfidence(result.confidence);

      // Auto-lock when confidence is high enough and no key is locked yet
      setLockedKey((prev) => {
        if (prev) return prev; // already locked
        if (result.confidence >= LOCK_THRESHOLD) return result.key;
        return null;
      });
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

    // Cancel any pending reset — player is active
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    // Idle decay after brief pause
    if (decayTimerRef.current) clearTimeout(decayTimerRef.current);
    decayTimerRef.current = window.setTimeout(() => {
      histogramRef.current = histogramRef.current.map((v) => v * 0.75);
      runDetection();

      // Long silence: reset key detection entirely after 12 seconds
      resetTimerRef.current = window.setTimeout(() => {
        histogramRef.current = new Array(12).fill(0);
        setLockedKey(null);
        setDetectedKey(null);
        setKeyConfidence(0);
      }, 12000);
    }, 3000);
  }, [runDetection]);

  const handleNoteOn = useCallback((note: number, velocity: number = 100) => {
    // Double-tap detection: same note struck twice quickly toggles latch mode
    const now = performance.now();
    const last = lastNoteTimeRef.current;
    if (last.note === note && now - last.time < DOUBLE_TAP_MS) {
      setLatchMode((v) => {
        const next = !v;
        if (!next) {
          // Turning off latch — release all non-held notes
          audio.allNotesOff();
          sustainedNotesRef.current.clear();
        }
        return next;
      });
      lastNoteTimeRef.current = { note: -1, time: 0 };
    } else {
      lastNoteTimeRef.current = { note, time: now };
    }

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/select
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const key = e.key.toLowerCase();
      if (key === "l") {
        e.preventDefault();
        setLatchMode((v) => {
          const next = !v;
          if (!next) clearLatch();
          return next;
        });
      } else if (key === "s") {
        e.preventDefault();
        setSuggestMode((v) => !v);
      } else if (key === "n") {
        e.preventDefault();
        setShowRomanNumerals((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearLatch]);

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

  const chord = detectChord(activeNotes, noteNames, activeKey);
  const sortedNotes = [...activeNotes].sort((a, b) => a - b);
  const hasNotes = activeNotes.size > 0;

  // Roman numeral for the current chord
  const roman = showRomanNumerals && activeKey && chord.root >= 0
    ? romanNumeral(chord.root, chord.suffix, activeKey)
    : null;

  return (
    <div className="app">
      <div className="chord-display">
        {hasNotes ? (
          <div className="chord-name-row">
            <h1 className={`chord-name ${chord.exact ? "active" : "uncertain"}`}>
              {chord.name}
            </h1>
            {chord.inversion && (
              <span className="inversion-label">{chord.inversion}</span>
            )}
          </div>
        ) : (
          <div className="empty-state">Play something</div>
        )}
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
          {(() => {
            // Build combined list: active notes + ghost notes, sorted by pitch class
            const pills: { key: string; label: string; missing: boolean; sortPc: number }[] = [];
            for (const note of sortedNotes) {
              pills.push({
                key: `n${note}`,
                label: noteName(note, noteNames),
                missing: false,
                sortPc: note % 12,
              });
            }
            if (suggestMode) {
              for (const pc of chord.missingNotes) {
                pills.push({
                  key: `m${pc}`,
                  label: noteNames[pc],
                  missing: true,
                  sortPc: pc,
                });
              }
            }
            // Sort by pitch class relative to the chord root so the chord is in order
            const root = chord.root >= 0 ? chord.root : 0;
            pills.sort((a, b) => ((a.sortPc - root + 12) % 12) - ((b.sortPc - root + 12) % 12));
            return pills.map((p) => (
              <span key={p.key} className={`pill ${p.missing ? "missing" : ""}`}>
                {p.label}
              </span>
            ));
          })()}
        </div>
      </div>

      <div className="keyboard-area">
        <Keyboard
          activeNotes={activeNotes}
          suggestedPitchClasses={suggestMode ? chord.missingNotes : []}
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
            className={`tool-btn ${suggestMode ? "active" : ""}`}
            onClick={() => setSuggestMode((v) => !v)}
            title="Show suggested notes to complete the chord (S)"
          >
            Suggestions <span className="shortcut">S</span>
          </button>
          <button
            className={`tool-btn ${showRomanNumerals ? "active" : ""}`}
            onClick={() => setShowRomanNumerals((v) => !v)}
            title="Show Roman numeral analysis (N)"
          >
            Numerals <span className="shortcut">N</span>
          </button>
          <button
            className={`tool-btn ${latchMode ? "active" : ""}`}
            onClick={() => {
              setLatchMode((v) => {
                if (v) clearLatch(); // turning off — release latched notes
                return !v;
              });
            }}
            title="Key Lock — notes stay held (press L or double-tap a key)"
          >
            Key Lock <span className="shortcut">L</span>
          </button>

          <div className="key-selector">
            <label htmlFor="key-select">Key:</label>
            <div className="key-select-wrapper">
              <select
                id="key-select"
                value={keyMode === "auto" ? "auto" : `${keyMode.tonic}-${keyMode.mode}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "auto") {
                    setKeyMode("auto");
                    setLockedKey(null);
                    histogramRef.current = new Array(12).fill(0);
                  } else {
                    const [tonic, mode] = val.split("-");
                    setKeyMode({ tonic: Number(tonic), mode: mode as "major" | "minor" });
                  }
                }}
              >
                <option value="auto">
                  Auto{lockedKey ? ` · ${formatKey(lockedKey)}` : detectedKey ? ` · ${formatKey(detectedKey)}…` : ""}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
