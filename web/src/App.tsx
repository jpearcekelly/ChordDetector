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
  const keyConfidenceRef = useRef(0);
  const histogramRef = useRef<number[]>(new Array(12).fill(0));
  const decayTimerRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  // Feature toggles
  const [showRomanNumerals, setShowRomanNumerals] = useState(false);
  const [latchMode, setLatchMode] = useState(false);
  const [suggestMode, setSuggestMode] = useState(true);
  const isMobile = typeof window !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [showHotkeys, setShowHotkeys] = useState(!isMobile);
  const [showNoteNames, setShowNoteNames] = useState(false);
  const [pedalDown, setPedalDown] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  // Track sustain pedal state and which notes are being sustained
  const sustainRef = useRef(false);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const sustainedNotesRef = useRef<Set<number>>(new Set());

  // Latch mode refs (need refs so callbacks don't go stale)
  const latchRef = useRef(false);
  latchRef.current = latchMode;

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
      keyConfidenceRef.current = result.confidence;

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
        keyConfidenceRef.current = 0;
      }, 12000);
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
      // Re-trigger audio even if note is already sustained by pedal
      audio.noteOff(note);
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
    setPedalDown(true);
  }, []);

  const handleSustainOff = useCallback(() => {
    sustainRef.current = false;
    setPedalDown(false);
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

  // QWERTY → MIDI mapping — centered on the keyboard display
  // Home row (A-') = C4–F5, top row = black keys
  // This places the bindings in the middle of the 4-octave keyboard
  const QWERTY_MAP: Record<string, number> = {
    // ── Home row: white keys C4–F5 ──
    a: 60, // C4 (middle C)
    s: 62, // D4
    d: 64, // E4
    f: 65, // F4
    g: 67, // G4
    h: 69, // A4
    j: 71, // B4
    k: 72, // C5
    l: 74, // D5
    ";": 76, // E5
    "'": 77, // F5
    // ── Top row: black keys (gaps at E-F, B-C) ──
    w: 61, // C#4
    e: 63, // D#4
    // r: skip (no black between E4-F4)
    t: 66, // F#4
    y: 68, // G#4
    u: 70, // A#4
    // i: skip (no black between B4-C5)
    o: 73, // C#5
    p: 75, // D#5
    // [: skip (no black between E5-F5)
    "]": 78, // F#5/Gb5 (black key)
    "\\": 79, // G5 (white key)
  };
  // Reverse map: MIDI note → display key label
  const MIDI_TO_KEY: Record<number, string> = {};
  for (const [key, midi] of Object.entries(QWERTY_MAP)) {
    MIDI_TO_KEY[midi] = key === ";" ? ";" : key === "'" ? "'" : key === "]" ? "]" : key === "\\" ? "\\" : key.toUpperCase();
  }

  const qwertyHeldRef = useRef<Set<string>>(new Set());

  // Keyboard: QWERTY piano + Cmd+key shortcuts
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      // Shift or Cmd/Ctrl + key = toolbar shortcuts
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
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
        } else if (key === "h") {
          e.preventDefault();
          setShowHotkeys((v) => !v);
        }
        return;
      }

      // Spacebar = sustain pedal
      if (e.key === " ") {
        e.preventDefault();
        if (!sustainRef.current) handleSustainOn();
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
      // Spacebar release = pedal up
      if (e.key === " ") {
        handleSustainOff();
        return;
      }

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
  }, [clearLatch, handleNoteOn, handleNoteOff, handleSustainOn, handleSustainOff]);

  useEffect(() => {
    initMIDI(
      {
        noteOn: handleNoteOn,
        noteOff: handleNoteOff,
        allNotesOff: handleAllNotesOff,
        sustainOn: handleSustainOn,
        sustainOff: handleSustainOff,
      },
      (status) => {
        setMidiStatus(status);
        // Auto-show hotkeys when no MIDI device is available (desktop only)
        if (!isMobile) {
          if (status.state === "unsupported" || status.state === "denied" ||
              (status.state === "connected" && status.deviceCount === 0)) {
            setShowHotkeys(true);
          } else if (status.state === "connected" && status.deviceCount > 0) {
            setShowHotkeys(false);
          }
        }
      },
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
    <div className={`app ${darkMode ? "dark" : "light"}`}>
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
          noteNameLabels={showNoteNames ? noteNames : undefined}
          darkMode={darkMode}
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
            Suggestions <span className="shortcut">&#8679;S</span>
          </button>
          <button
            className={`tool-btn ${showRomanNumerals ? "active" : ""}`}
            onClick={() => setShowRomanNumerals((v) => !v)}
            title="Show Roman numeral analysis (N)"
          >
            Numerals <span className="shortcut">&#8679;N</span>
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
            Key Lock <span className="shortcut">&#8679;L</span>
          </button>
          <button
            className={`tool-btn ${showHotkeys ? "active" : ""}`}
            onClick={() => setShowHotkeys((v) => !v)}
            title="Show keyboard shortcuts on piano keys (Shift+H)"
          >
            Hotkeys <span className="shortcut">&#8679;H</span>
          </button>
          <span className={`tool-btn pedal-indicator ${pedalDown ? "active" : ""}`}>
            Pedal <span className="shortcut">Space</span>
          </span>
          <button
            className={`tool-btn ${showNoteNames ? "active" : ""}`}
            onClick={() => setShowNoteNames((v) => !v)}
            title="Show note names on keys"
          >
            Notes
          </button>
          <button
            className="tool-btn"
            onClick={() => setDarkMode((v) => !v)}
            title="Toggle light/dark mode"
          >
            {darkMode ? "Light" : "Dark"}
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
