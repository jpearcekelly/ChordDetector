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
  const [showHotkeys, setShowHotkeys] = useState(false);

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

  // QWERTY → MIDI mapping — mirrors piano layout with proper gaps
  // Home row (A-') = C3–F4, bottom row (Z-/) = C2–E3
  // Black keys on row above each, skipping E-F and B-C gaps
  const QWERTY_MAP: Record<string, number> = {
    // ── Home row: white keys C3–F4 ──
    a: 48, // C3
    s: 50, // D3
    d: 52, // E3
    f: 53, // F3
    g: 55, // G3
    h: 57, // A3
    j: 59, // B3
    k: 60, // C4 (middle C)
    l: 62, // D4
    ";": 64, // E4
    "'": 65, // F4
    // ── Top row: black keys for home row (gaps at E-F, B-C) ──
    w: 49, // C#3
    e: 51, // D#3
    // r: skip (no black between E3-F3)
    t: 54, // F#3
    y: 56, // G#3
    u: 58, // A#3
    // i: skip (no black between B3-C4)
    o: 61, // C#4
    p: 63, // D#4
    // [: skip (no black between E4-F4)
    // ── Bottom row: white keys C2–E3 ──
    z: 36, // C2
    x: 38, // D2
    c: 40, // E2
    v: 41, // F2
    b: 43, // G2
    n: 45, // A2
    m: 47, // B2
    ",": 48, // C3
    ".": 50, // D3
    "/": 52, // E3
    // ── Number row: black keys for bottom row ──
    "2": 37, // C#2
    "3": 39, // D#2
    // 4: skip (no black between E2-F2)
    "5": 42, // F#2
    "6": 44, // G#2
    "7": 46, // A#2
    // 8: skip (no black between B2-C3)
    "9": 49, // C#3
    "0": 51, // D#3
    // -: skip (no black between E3-F3)
  };
  // Reverse map: MIDI note → display key label (prefer home row over bottom row for duplicates)
  const MIDI_TO_KEY: Record<number, string> = {};
  // Fill bottom row first, then home row overwrites duplicates (home row wins)
  for (const [key, midi] of Object.entries(QWERTY_MAP)) {
    const row = "zxcvbnm,./".includes(key) || "234567890".includes(key) ? "bottom" : "home";
    if (row === "bottom" && !(midi in MIDI_TO_KEY)) {
      MIDI_TO_KEY[midi] = key === "," ? "," : key === "." ? "." : key === "/" ? "/" : key === ";" ? ";" : key === "'" ? "'" : key.toUpperCase();
    } else if (row === "home") {
      MIDI_TO_KEY[midi] = key === ";" ? ";" : key === "'" ? "'" : key.toUpperCase();
    }
  }

  const qwertyHeldRef = useRef<Set<string>>(new Set());

  // Keyboard: QWERTY piano + Cmd+key shortcuts
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      // Shift+H = toggle hotkey labels
      if (e.shiftKey && e.key === "H") {
        e.preventDefault();
        setShowHotkeys((v) => !v);
        return;
      }

      // Cmd/Ctrl + key = toolbar shortcuts
      if (e.metaKey || e.ctrlKey) {
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
        return;
      }

      // QWERTY piano keys
      const key = e.key.toLowerCase();
      const midi = QWERTY_MAP[key];
      if (midi !== undefined && !qwertyHeldRef.current.has(key)) {
        e.preventDefault();
        qwertyHeldRef.current.add(key);
        handleNoteOn(midi);
      }
    };

    const handleUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const midi = QWERTY_MAP[key];
      if (midi !== undefined && qwertyHeldRef.current.has(key)) {
        qwertyHeldRef.current.delete(key);
        handleNoteOff(midi);
      }
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
    };
  }, [clearLatch, handleNoteOn, handleNoteOff]);

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
          hotkeyLabels={showHotkeys ? MIDI_TO_KEY : undefined}
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
            Suggestions <span className="shortcut">&#8984;S</span>
          </button>
          <button
            className={`tool-btn ${showRomanNumerals ? "active" : ""}`}
            onClick={() => setShowRomanNumerals((v) => !v)}
            title="Show Roman numeral analysis (N)"
          >
            Numerals <span className="shortcut">&#8984;N</span>
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
            Key Lock <span className="shortcut">&#8984;L</span>
          </button>
          <button
            className={`tool-btn ${showHotkeys ? "active" : ""}`}
            onClick={() => setShowHotkeys((v) => !v)}
            title="Show keyboard shortcuts on piano keys (Shift+H)"
          >
            Hotkeys <span className="shortcut">&#8679;H</span>
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
