import { useState, useEffect, useCallback, useRef } from "react";
import Keyboard from "./components/Keyboard";
import { detectChord, noteName } from "./lib/chordDetector";
import { initMIDI, type MIDIStatus } from "./lib/midiEngine";
import { detectKey, noteNamesForKey, formatKey, allKeys, romanNumeral, scaleNotes, SCALE_MODES, type Key, type ScaleMode } from "./lib/keyDetector";
import * as audio from "./lib/audioEngine";
import { startMic, stopMic, type MicStatus } from "./lib/micEngine";
import Ripples from "./components/Ripples";
import Particles from "./components/Particles";
import "./App.css";

const ALL_KEYS = allKeys();

export default function App() {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [midiStatus, setMidiStatus] = useState<MIDIStatus>({ state: "pending" });
  const [samplesLoaded, setSamplesLoaded] = useState(audio.isSamplerLoaded());

  // Key detection state
  const [keyMode, setKeyMode] = useState<"none" | "auto" | Key>("none");
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
  const [scrollLocked, setScrollLocked] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode | null>(null);
  const [showRipples, setShowRipples] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  // Incremented on each note-on to trigger particle bursts even for re-struck notes
  const [noteOnEvent, setNoteOnEvent] = useState<{ note: number; velocity: number; id: number }>({ note: 0, velocity: 0, id: 0 });
  const [micEnabled, setMicEnabled] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("off");
  const micNotesRef = useRef<Set<number>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    audio.getAudioEngine(); // start loading samples
    audio.onSamplerLoaded(() => setSamplesLoaded(true));
  }, []);

  // Track sustain pedal state and which notes are being sustained
  const sustainRef = useRef(false);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const sustainedNotesRef = useRef<Set<number>>(new Set());

  // Latch mode refs (need refs so callbacks don't go stale)
  const latchRef = useRef(false);
  latchRef.current = latchMode;
  const micActiveRef = useRef(false);
  micActiveRef.current = micEnabled && micStatus === "active";

  // The active key: manual override > auto-locked > detecting
  const activeKey = keyMode === "none" ? null : keyMode === "auto" ? (lockedKey ?? detectedKey) : keyMode;
  const noteNames = noteNamesForKey(activeKey);
  const scalePitchClasses = activeKey && scaleMode ? scaleNotes(activeKey.tonic, scaleMode) : [];

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
    const playAudio = !micActiveRef.current; // suppress audio when mic is active
    if (playAudio) audio.ensureAudioContext();
    // In latch mode, playing a note that's already held toggles it off
    if (latchRef.current) {
      setActiveNotes((prev) => {
        if (prev.has(note)) {
          if (playAudio) audio.noteOff(note);
          const next = new Set(prev);
          next.delete(note);
          return next;
        }
        if (playAudio) audio.noteOn(note, velocity);
        return new Set(prev).add(note);
      });
    } else {
      // Re-trigger audio even if note is already sustained by pedal
      if (playAudio) {
        audio.noteOff(note);
        audio.noteOn(note, velocity);
      }
      setActiveNotes((prev) => new Set(prev).add(note));
    }
    heldNotesRef.current.add(note);
    sustainedNotesRef.current.delete(note);
    updateHistogram(note);
    setNoteOnEvent({ note, velocity, id: Date.now() });
  }, [updateHistogram]);

  const handleNoteOff = useCallback((note: number) => {
    heldNotesRef.current.delete(note);
    const playAudio = !micActiveRef.current;

    // In latch mode, don't release notes
    if (latchRef.current) return;

    if (sustainRef.current) {
      sustainedNotesRef.current.add(note);
    } else {
      if (playAudio) audio.noteOff(note);
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

  // QWERTY → MIDI mapping — H = middle C (C4)
  // Home row (A-') = E3–A4, top row = black keys
  const QWERTY_MAP: Record<string, number> = {
    // ── Home row: white keys E3–A4 ──
    a: 52, // E3
    s: 53, // F3
    d: 55, // G3
    f: 57, // A3
    g: 59, // B3
    h: 60, // C4 (middle C)
    j: 62, // D4
    k: 64, // E4
    l: 65, // F4
    ";": 67, // G4
    "'": 69, // A4
    // ── Top row: black keys (gaps at E-F, B-C) ──
    // w: skip (no black between E3-F3)
    e: 54, // F#3
    r: 56, // G#3
    t: 58, // A#3
    // y: skip (no black between B3-C4)
    u: 61, // C#4
    i: 63, // D#4
    // o: skip (no black between E4-F4)
    p: 66, // F#4
    "[": 68, // G#4
    "]": 70, // A#4
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

  // Mic toggle
  useEffect(() => {
    if (micEnabled) {
      startMic({
        onNotesChanged: (detected) => {
          const prev = micNotesRef.current;
          // Notes that appeared
          for (const note of detected) {
            if (!prev.has(note)) handleNoteOn(note, 80);
          }
          // Notes that disappeared
          for (const note of prev) {
            if (!detected.has(note)) handleNoteOff(note);
          }
          micNotesRef.current = new Set(detected);
        },
        onStatusChange: setMicStatus,
      });
    } else {
      stopMic();
      // Release any mic-held notes
      for (const note of micNotesRef.current) {
        handleNoteOff(note);
      }
      micNotesRef.current.clear();
    }
    return () => { if (micEnabled) stopMic(); };
  }, [micEnabled, handleNoteOn, handleNoteOff]);

  const chord = detectChord(activeNotes, noteNames, activeKey);
  const sortedNotes = [...activeNotes].sort((a, b) => a - b);
  const hasNotes = activeNotes.size > 0;

  // Roman numeral for the current chord
  const roman = showRomanNumerals && activeKey && chord.root >= 0
    ? romanNumeral(chord.root, chord.suffix, activeKey)
    : null;

  return (
    <div className={`app ${darkMode ? "dark" : "light"}`}>
      <div className="status-bar">
        <span className="status-left">
          <div className="key-selector">
            <label htmlFor="input-select">Input:</label>
            <div className="key-select-wrapper">
              <select
                id="input-select"
                value={micEnabled ? "mic" : "midi"}
                onChange={(e) => {
                  if (e.target.value === "mic") {
                    setMicEnabled(true);
                  } else {
                    setMicEnabled(false);
                  }
                }}
              >
                <option value="midi">
                  {midiStatus.state === "connected" && midiStatus.deviceCount > 0
                    ? `MIDI (${midiStatus.deviceCount} device${midiStatus.deviceCount > 1 ? "s" : ""})`
                    : midiStatus.state === "connected" && midiStatus.deviceCount === 0
                    ? "MIDI (no devices)"
                    : midiStatus.state === "pending" ? "MIDI (connecting…)"
                    : midiStatus.state === "unsupported" ? "On-screen keyboard"
                    : "MIDI (denied)"}
                </option>
                <option value="mic">
                  {micStatus === "active" ? "Microphone (active)"
                    : micStatus === "requesting" ? "Microphone (requesting…)"
                    : micStatus === "denied" ? "Microphone (denied)"
                    : "Microphone"}
                </option>
              </select>
            </div>
          </div>
        </span>

        <div className="toolbar">
          {/* ── Primary controls ── */}
          <button
            className={`tool-btn ${latchMode ? "active" : ""}`}
            onClick={() => {
              setLatchMode((v) => {
                if (v) clearLatch();
                return !v;
              });
            }}
            title="Key Lock — notes stay held (⇧L)"
          >
            Lock <span className="shortcut">&#8679;L</span>
          </button>
          {showHotkeys && (
            <span className={`tool-btn pedal-indicator ${pedalDown ? "active" : ""}`}>
              Pedal <span className="shortcut">Space</span>
            </span>
          )}
          <div className="key-selector">
            <label htmlFor="key-select">Key:</label>
            <div className="key-select-wrapper">
              <select
                id="key-select"
                value={keyMode === "none" ? "none" : keyMode === "auto" ? "auto" : `${keyMode.tonic}-${keyMode.mode}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "none") {
                    setKeyMode("none");
                  } else if (val === "auto") {
                    setKeyMode("auto");
                    setLockedKey(null);
                    histogramRef.current = new Array(12).fill(0);
                  } else {
                    const [tonic, mode] = val.split("-");
                    setKeyMode({ tonic: Number(tonic), mode: mode as "major" | "minor" });
                  }
                }}
              >
                <option value="none">None</option>
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

          {/* ── Scale selector — only when a specific key is set ── */}
          {activeKey && (
            <div className="key-selector">
              <label htmlFor="scale-select">Scale:</label>
              <div className="key-select-wrapper">
                <select
                  id="scale-select"
                  value={scaleMode ? scaleMode.name : "off"}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "off") {
                      setScaleMode(null);
                    } else {
                      setScaleMode(SCALE_MODES.find((m) => m.name === val) ?? null);
                    }
                  }}
                >
                  <option value="off">Off</option>
                  <optgroup label="Modes">
                    {SCALE_MODES.filter((m) => m.category === "diatonic").map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Minor Variants">
                    {SCALE_MODES.filter((m) => m.category === "minor-variant").map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Pentatonic / Blues">
                    {SCALE_MODES.filter((m) => m.category === "pentatonic").map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>
          )}

          {/* ── Gear menu ── */}
          <div className="settings-menu">
            <button
              className={`tool-btn settings-toggle ${settingsOpen ? "active" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
              title="More settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {settingsOpen && (
              <>
                <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />
                <div className="settings-popover">
                  <button
                    className={`settings-item ${suggestMode ? "active" : ""}`}
                    onClick={() => setSuggestMode((v) => !v)}
                  >
                    Suggestions <span className="shortcut">&#8679;S</span>
                  </button>
                  <button
                    className={`settings-item ${showRomanNumerals ? "active" : ""}`}
                    onClick={() => setShowRomanNumerals((v) => !v)}
                  >
                    Roman Numerals <span className="shortcut">&#8679;N</span>
                  </button>
                  <button
                    className={`settings-item ${showHotkeys ? "active" : ""}`}
                    onClick={() => setShowHotkeys((v) => !v)}
                  >
                    Hotkeys <span className="shortcut">&#8679;H</span>
                  </button>
                  <button
                    className={`settings-item ${showNoteNames ? "active" : ""}`}
                    onClick={() => setShowNoteNames((v) => !v)}
                  >
                    Note Names
                  </button>
                  <button
                    className={`settings-item ${scrollLocked ? "active" : ""}`}
                    onClick={() => setScrollLocked((v) => !v)}
                  >
                    Lock Keyboard
                  </button>
                  <button
                    className={`settings-item ${showRipples ? "active" : ""}`}
                    onClick={() => setShowRipples((v) => !v)}
                  >
                    Ripples
                  </button>
                  <button
                    className={`settings-item ${showParticles ? "active" : ""}`}
                    onClick={() => setShowParticles((v) => !v)}
                  >
                    Particles
                  </button>
                  <button
                    className={`settings-item ${!darkMode ? "active" : ""}`}
                    onClick={() => setDarkMode((v) => !v)}
                  >
                    Light Mode
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="chord-display" style={{ position: "relative" }}>
        {showRipples && (
          <Ripples noteOnEvent={noteOnEvent} chordSuffix={chord.suffix} chordExact={chord.exact} darkMode={darkMode} />
        )}
        {showParticles && (
          <Particles activeNotes={activeNotes} noteOnEvent={noteOnEvent} chordSuffix={chord.suffix} chordExact={chord.exact} darkMode={darkMode} />
        )}
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
          <div className="empty-state">
            {!samplesLoaded ? "Loading sounds…"
              : micStatus === "active" ? "Play your piano…"
              : midiStatus.state === "connected" && midiStatus.deviceCount > 0 ? "Play something"
              : "Click the keys or connect a MIDI device"}
          </div>
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
          scalePitchClasses={scalePitchClasses}
          hotkeyLabels={showHotkeys ? MIDI_TO_KEY : undefined}
          noteNameLabels={showNoteNames ? noteNames : undefined}
          darkMode={darkMode}
          scrollLocked={scrollLocked}
          onNoteOn={(n) => handleNoteOn(n)}
          onNoteOff={handleNoteOff}
        />
      </div>

    </div>
  );
}
