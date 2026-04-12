import { useState, useEffect, useCallback, useRef } from "react";
import Keyboard from "./components/Keyboard";
import { detectChord, noteName } from "./lib/chordDetector";
import { initMIDI, type MIDIStatus } from "./lib/midiEngine";
import { detectKey, noteNamesForKey, formatKey, allKeys, romanNumeral, scaleNotes, SCALE_MODES, type Key, type ScaleMode } from "./lib/keyDetector";
import * as audio from "./lib/audioEngine";
import { startMic, stopMic, type MicStatus } from "./lib/micEngine";
import Ripples from "./components/Ripples";
import Particles from "./components/Particles";
import HotkeyBadge from "./components/HotkeyBadge";
import ChromeSelect from "./components/ChromeSelect";
import "./App.css";

const ALL_KEYS = allKeys();

export default function App() {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [midiStatus, setMidiStatus] = useState<MIDIStatus>({ state: "pending" });
  const [_samplesLoaded, setSamplesLoaded] = useState(audio.isSamplerLoaded());

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
  const [darkMode, setDarkMode] = useState(false);
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
      <div className="chrome-bar">
        <div className="chrome-cell chrome-brand">
          Tonal
        </div>

        <ChromeSelect
          className="chrome-hide-mobile"
          id="input-select"
          value={micEnabled ? "mic" : "midi"}
          onChange={(val) => setMicEnabled(val === "mic")}
          statusDot={
            micEnabled
              ? (micStatus === "active" ? "connected" : micStatus === "requesting" ? "pending" : "denied")
              : (midiStatus.state === "connected" && midiStatus.deviceCount > 0 ? "connected"
                : midiStatus.state === "pending" ? "pending" : "denied")
          }
        >
          <option value="midi">
            {midiStatus.state === "unsupported" ? "Keyboard" : "Midi"}
          </option>
          <option value="mic">Microphone</option>
        </ChromeSelect>

        <ChromeSelect
          className="chrome-hide-mobile"
          id="key-select"
          value={keyMode === "none" ? "none" : keyMode === "auto" ? "auto" : `${keyMode.tonic}-${keyMode.mode}`}
          onChange={(val) => {
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
          inactive={keyMode === "none"}
        >
          <option value="none">No key</option>
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
        </ChromeSelect>

        <ChromeSelect
          className="chrome-hide-mobile"
          id="scale-select"
          value={scaleMode ? scaleMode.name : "off"}
          onChange={(val) => {
            if (val === "off") {
              setScaleMode(null);
            } else {
              setScaleMode(SCALE_MODES.find((m) => m.name === val) ?? null);
              if (keyMode === "none") {
                setKeyMode({ tonic: 0, mode: "major" });
              }
            }
          }}
          inactive={!scaleMode}
        >
          <option value="off">No scale</option>
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
        </ChromeSelect>

        <div
          className={`chrome-cell chrome-toggle ${latchMode ? "active" : ""}`}
          onClick={() => {
            setLatchMode((v) => {
              if (v) clearLatch();
              return !v;
            });
          }}
          title="Key Lock — notes stay held (⇧L)"
        >
          Key lock <HotkeyBadge label="Shift+L" active={latchMode} />
        </div>

        {showHotkeys && (
          <div className={`chrome-cell chrome-toggle chrome-hide-mobile ${pedalDown ? "active" : ""}`}>
            Pedal <HotkeyBadge label="Space" active={pedalDown} />
          </div>
        )}

        <div className="chrome-cell chrome-spacer" />

        <div
          className="chrome-cell chrome-settings"
          onClick={() => setSettingsOpen((v) => !v)}
          style={{ cursor: "pointer" }}
        >
          <div className="settings-menu">
            <span className="settings-trigger">
              <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><rect y="0" width="16" height="1.5" rx="0.75" /><rect y="5.25" width="16" height="1.5" rx="0.75" /><rect y="10.5" width="16" height="1.5" rx="0.75" /></svg>
            </span>
            {settingsOpen && (
              <>
                <div className="settings-backdrop" onClick={(e) => { e.stopPropagation(); setSettingsOpen(false); }} />
                <div className="settings-popover" onClick={(e) => e.stopPropagation()}>
                  <div className="settings-mobile-selects">
                    <div className="settings-mobile-row">
                      <span className="settings-mobile-label">Input</span>
                      <select
                        className="settings-mobile-select"
                        value={micEnabled ? "mic" : "midi"}
                        onChange={(e) => { setMicEnabled(e.target.value === "mic"); e.target.blur(); }}
                      >
                        <option value="midi">Midi</option>
                        <option value="mic">Microphone</option>
                      </select>
                    </div>
                    <div className="settings-mobile-row">
                      <span className="settings-mobile-label">Key</span>
                      <select
                        className="settings-mobile-select"
                        value={keyMode === "none" ? "none" : keyMode === "auto" ? "auto" : `${keyMode.tonic}-${keyMode.mode}`}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "none") setKeyMode("none");
                          else if (val === "auto") { setKeyMode("auto"); setLockedKey(null); histogramRef.current = new Array(12).fill(0); }
                          else { const [t, m] = val.split("-"); setKeyMode({ tonic: Number(t), mode: m as "major" | "minor" }); }
                          e.target.blur();
                        }}
                      >
                        <option value="none">None</option>
                        <option value="auto">Auto{lockedKey ? ` · ${formatKey(lockedKey)}` : ""}</option>
                        {ALL_KEYS.filter((k) => k.mode === "major").map((k) => (
                          <option key={`${k.tonic}-${k.mode}`} value={`${k.tonic}-${k.mode}`}>{formatKey(k)}</option>
                        ))}
                        {ALL_KEYS.filter((k) => k.mode === "minor").map((k) => (
                          <option key={`${k.tonic}-${k.mode}`} value={`${k.tonic}-${k.mode}`}>{formatKey(k)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-mobile-row">
                      <span className="settings-mobile-label">Scale</span>
                      <select
                        className="settings-mobile-select"
                        value={scaleMode ? scaleMode.name : "off"}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "off") setScaleMode(null);
                          else { setScaleMode(SCALE_MODES.find((m) => m.name === val) ?? null); if (keyMode === "none") setKeyMode({ tonic: 0, mode: "major" }); }
                          e.target.blur();
                        }}
                      >
                        <option value="off">None</option>
                        {SCALE_MODES.map((m) => (
                          <option key={m.name} value={m.name}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    className={`settings-item ${suggestMode ? "active" : ""}`}
                    onClick={() => setSuggestMode((v) => !v)}
                  >
                    Suggestions
                  </button>
                  <button
                    className={`settings-item ${showRomanNumerals ? "active" : ""}`}
                    onClick={() => setShowRomanNumerals((v) => !v)}
                  >
                    Roman Numerals
                  </button>
                  <button
                    className={`settings-item ${showHotkeys ? "active" : ""}`}
                    onClick={() => setShowHotkeys((v) => !v)}
                  >
                    Hotkeys
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
                    className={`settings-item ${darkMode ? "active" : ""}`}
                    onClick={() => setDarkMode((v) => !v)}
                  >
                    Dark Mode
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
        ) : null}
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
            const scaleSet = new Set(scalePitchClasses);
            const hasScale = scaleSet.size > 0;
            return pills.map((p) => {
              const inScale = hasScale && scaleSet.has(p.sortPc);
              const pillClass = p.missing ? "missing"
                : hasScale ? (inScale ? "in-scale" : "out-scale")
                : "";
              return (
                <span key={p.key} className={`pill ${pillClass}`}>
                  {p.label}
                </span>
              );
            });
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
