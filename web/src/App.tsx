import { useState, useEffect, useCallback, useRef } from "react";
import Keyboard from "./components/Keyboard";
import { detectChord, noteName } from "./lib/chordDetector";
import { initMIDI, type MIDIStatus } from "./lib/midiEngine";
import { detectKey, noteNamesForKey, formatKey, allKeys, romanNumeral, scaleNotes, SCALE_MODES, type Key, type ScaleMode } from "./lib/keyDetector";
import * as audio from "./lib/audioEngine";
import type { SoundType } from "./lib/audioEngine";
import { startMic, stopMic, type MicStatus } from "./lib/micEngine";
import { startCamera, stopCamera, pauseCamera, resumeCamera, type CameraStatus } from "./lib/cameraEngine";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import CameraOverlay from "./components/CameraOverlay";
import Ripples from "./components/Ripples";
import Particles from "./components/Particles";
import SplashScreen from "./components/SplashScreen";
import type { InputChoice } from "./components/SplashScreen";
import RotatePrompt from "./components/RotatePrompt";
import HotkeyBadge from "./components/HotkeyBadge";
import ChromeSelect from "./components/ChromeSelect";
import NotePill from "./components/NotePill";
import type { PillVariant } from "./components/NotePill";
import Coachmark from "./components/Coachmark";
import "./App.css";

const ALL_KEYS = allKeys();

export default function App() {
  // Track mobile breakpoint to conditionally show note pills on keys
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
  const [showHotkeys, setShowHotkeys] = useState(!isMobile);
  const [showNoteNames, setShowNoteNames] = useState(false);
  const [pedalDown, setPedalDown] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");
  const [scrollLocked, setScrollLocked] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode | null>(null);
  const [scaleDemoPlaying, setScaleDemoPlaying] = useState(false);
  const scaleDemoRef = useRef<number[]>([]);
  const scaleDemoPrevNote = useRef(-1);
  const [showRipples, setShowRipples] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  const [sound, setSound] = useState<SoundType>(() => (localStorage.getItem("sound") as SoundType) || "piano");
  // Incremented on each note-on to trigger particle bursts even for re-struck notes
  const [noteOnEvent, setNoteOnEvent] = useState<{ note: number; velocity: number; id: number }>({ note: 0, velocity: 0, id: 0 });
  const [micEnabled, setMicEnabled] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("off");
  const micNotesRef = useRef<Set<number>>(new Set());
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("off");
  const [cameraVideo, setCameraVideo] = useState<HTMLVideoElement | null>(null);
  const [cameraLandmarks, setCameraLandmarks] = useState<NormalizedLandmark[][] | null>(null);
  const cameraNotesRef = useRef<Set<number>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [midiRequested, setMidiRequested] = useState(false);
  const splashVisibleRef = useRef(true);
  const [splashChoice, setSplashChoice] = useState<InputChoice | null>(null);
  const [noteLockTooltip, setNoteLockTooltip] = useState("");
  const noteLockEnableShown = useRef(false);
  const noteLockDisableShown = useRef(false);
  const noteLockRef = useRef<HTMLDivElement>(null);

  const handleSplashSelect = useCallback((choice: InputChoice) => {
    audio.ensureAudioContext();
    if (choice === "mic") setMicEnabled(true);
    if (choice === "midi") setMidiRequested(true);
    if (choice === "keyboard") setLatchMode(true);
    if (choice === "camera") setCameraEnabled(true);
    setSplashChoice(choice);
    setSplashFading(true);
    splashVisibleRef.current = false;
    setTimeout(() => setSplashVisible(false), 400);
  }, []);

  const triggerThemeToggle = useCallback((e: React.MouseEvent) => {
    const flipTheme = () => setDarkMode((d) => { const next = !d; localStorage.setItem("darkMode", String(next)); return next; });
    const doc = document.documentElement;
    if (!(document as any).startViewTransition) {
      flipTheme();
      return;
    }
    doc.style.setProperty("--ink-x", `${e.clientX}px`);
    doc.style.setProperty("--ink-y", `${e.clientY}px`);
    (document as any).startViewTransition(flipTheme);
  }, []);

  useEffect(() => {
    if (!splashVisible) return;
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSplashSelect("keyboard");
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [splashVisible, handleSplashSelect]);

  useEffect(() => {
    if (!navigator.permissions || !("requestMIDIAccess" in navigator)) return;
    const desc = { name: "midi" } as PermissionDescriptor;
    navigator.permissions.query(desc).then((result) => {
      if (result.state === "granted") setMidiRequested(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    audio.getAudioEngine(); // start loading samples
    audio.onSamplerLoaded(() => setSamplesLoaded(true));
    // Restore saved sound preference
    const saved = localStorage.getItem("sound") as SoundType | null;
    if (saved && saved !== "piano") audio.setSound(saved);
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

  const handleNoteOn = useCallback((note: number, velocity: number = 100, fromMic: boolean = false) => {
    const playAudio = !fromMic;
    if (playAudio) audio.ensureAudioContext();
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

  const handleNoteOff = useCallback((note: number, fromMic: boolean = false) => {
    heldNotesRef.current.delete(note);
    const playAudio = !fromMic;

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

  const replayChord = useCallback(() => {
    if (activeNotes.size === 0) return;
    audio.ensureAudioContext();
    for (const note of activeNotes) {
      audio.noteOff(note);
      audio.noteOn(note, 80);
    }
    setNoteOnEvent({ note: [...activeNotes][0], velocity: 80, id: Date.now() });
  }, [activeNotes]);

  // Clear latched notes
  const clearLatch = useCallback(() => {
    audio.allNotesOff();
    sustainedNotesRef.current.clear();
    setActiveNotes(new Set(heldNotesRef.current));
  }, []);

  const stopScaleDemo = useCallback(() => {
    for (const id of scaleDemoRef.current) clearTimeout(id);
    scaleDemoRef.current = [];
    audio.allNotesOff();
    setActiveNotes(new Set(heldNotesRef.current));
    setScaleDemoPlaying(false);
  }, []);

  const startScaleDemo = useCallback(() => {
    if (!scaleMode || !activeKey) return;
    audio.ensureAudioContext();
    stopScaleDemo();

    const pitchClasses = scaleNotes(activeKey.tonic, scaleMode);
    const midiNotes: number[] = [];
    for (let midi = 36; midi <= 84; midi++) {
      if (pitchClasses.includes(midi % 12)) midiNotes.push(midi);
    }
    const sequence = [...midiNotes, ...midiNotes.slice(0, -1).reverse()];

    setScaleDemoPlaying(true);
    scaleDemoPrevNote.current = -1;
    const tempo = 120;

    for (let i = 0; i < sequence.length; i++) {
      const id = window.setTimeout(() => {
        if (scaleDemoPrevNote.current >= 0) {
          audio.noteOff(scaleDemoPrevNote.current);
        }
        const note = sequence[i];
        audio.noteOn(note, 80);
        setActiveNotes(new Set([note]));
        scaleDemoPrevNote.current = note;

        if (i === sequence.length - 1) {
          const endId = window.setTimeout(() => {
            audio.noteOff(note);
            setActiveNotes(new Set(heldNotesRef.current));
            setScaleDemoPlaying(false);
            scaleDemoRef.current = [];
          }, tempo);
          scaleDemoRef.current.push(endId);
        }
      }, i * tempo);
      scaleDemoRef.current.push(id);
    }
  }, [scaleMode, activeKey, stopScaleDemo]);

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
      if (splashVisibleRef.current) return;
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
          setNoteLockTooltip("");
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

      // Enter = replay held chord
      if (e.key === "Enter") {
        e.preventDefault();
        replayChord();
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
        if (latchMode && splashChoice === "keyboard" && !noteLockDisableShown.current) {
          noteLockDisableShown.current = true;
          setNoteLockTooltip("Disable Note Lock to play naturally");
        }
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
  }, [clearLatch, handleNoteOn, handleNoteOff, handleSustainOn, handleSustainOff, replayChord, latchMode, splashChoice]);

  useEffect(() => {
    if (!midiRequested) return;
    initMIDI(
      {
        noteOn: (note: number, velocity: number) => {
          handleNoteOn(note, velocity);
          if (latchMode && splashChoice === "keyboard" && !noteLockDisableShown.current) {
            noteLockDisableShown.current = true;
            setNoteLockTooltip("Disable Note Lock to play naturally");
          }
        },
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
  }, [midiRequested, handleNoteOn, handleNoteOff, handleAllNotesOff, handleSustainOn, handleSustainOff, latchMode, splashChoice]);

  // Mic toggle
  useEffect(() => {
    if (micEnabled) {
      startMic({
        onNotesChanged: (detected) => {
          const prev = micNotesRef.current;
          for (const note of detected) {
            if (!prev.has(note)) handleNoteOn(note, 80, true);
          }
          for (const note of prev) {
            if (!detected.has(note)) handleNoteOff(note, true);
          }
          micNotesRef.current = new Set(detected);
        },
        onStatusChange: setMicStatus,
      });
    } else {
      stopMic();
      for (const note of micNotesRef.current) {
        handleNoteOff(note, true);
      }
      micNotesRef.current.clear();
    }
    return () => { if (micEnabled) stopMic(); };
  }, [micEnabled, handleNoteOn, handleNoteOff]);

  useEffect(() => {
    if (cameraEnabled) {
      startCamera({
        onNoteOn: (note, velocity) => {
          cameraNotesRef.current.add(note);
          handleNoteOn(note, velocity);
        },
        onNoteOff: (note) => {
          cameraNotesRef.current.delete(note);
          handleNoteOff(note);
        },
        onStatusChange: setCameraStatus,
        onVideoReady: setCameraVideo,
        onLandmarks: setCameraLandmarks,
      });
    } else {
      stopCamera();
      for (const note of cameraNotesRef.current) {
        handleNoteOff(note);
      }
      cameraNotesRef.current.clear();
      setCameraVideo(null);
      setCameraLandmarks(null);
    }
    return () => { if (cameraEnabled) stopCamera(); };
  }, [cameraEnabled, handleNoteOn, handleNoteOff]);

  useEffect(() => {
    if (!cameraEnabled) return;
    if (settingsOpen) pauseCamera(); else resumeCamera();
  }, [cameraEnabled, settingsOpen]);

  const chord = detectChord(activeNotes, noteNames, activeKey);
  const sortedNotes = [...activeNotes].sort((a, b) => a - b);
  const hasNotes = activeNotes.size > 0;

  // Roman numeral for the current chord
  const roman = showRomanNumerals && activeKey && chord.root >= 0
    ? romanNumeral(chord.root, chord.suffix, activeKey)
    : null;

  return (
    <div className={`app ${darkMode ? "dark" : "light"} ${cameraEnabled && cameraVideo ? "camera-active" : ""}`}>
      {cameraEnabled && cameraVideo && (
        <CameraOverlay video={cameraVideo} landmarks={cameraLandmarks} />
      )}
      <RotatePrompt />
      {splashVisible && (
        <SplashScreen
          midiStatus={midiStatus}
          isMobile={isMobile}
          darkMode={darkMode}
          onToggleDarkMode={triggerThemeToggle}
          onSelect={handleSplashSelect}
          className={splashFading ? "fade-out" : ""}
        />
      )}
      <div className="chrome-bar" ref={(el) => {
        if (el) document.documentElement.style.setProperty("--chrome-bar-height", el.offsetHeight + "px");
      }}>
        <div className="chrome-cell chrome-brand">
          Tonal
        </div>

        <ChromeSelect
          className="chrome-hide-mobile"
          id="input-select"
          value={cameraEnabled ? "camera" : micEnabled ? "mic" : "keyboard"}
          onChange={(val) => {
            setMicEnabled(val === "mic");
            setCameraEnabled(val === "camera");
            if (val === "keyboard") setMidiRequested(true);
          }}
          statusDot={
            cameraEnabled
              ? (cameraStatus === "active" ? "connected" : cameraStatus === "requesting" || cameraStatus === "loading" ? "pending" : "denied")
              : micEnabled
                ? (micStatus === "active" ? "connected" : micStatus === "requesting" ? "pending" : "denied")
                : (midiStatus.state === "connected" && midiStatus.deviceCount > 0 ? "connected"
                  : midiStatus.state === "pending" ? "pending" : "denied")
          }
        >
          <option value="keyboard">
            {midiStatus.state === "unsupported" ? "Keyboard" : "Midi"}
          </option>
          <option value="mic">Microphone</option>
          <option value="camera">Camera</option>
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

        {scaleMode && activeKey && (
          <div
            className={`chrome-cell chrome-toggle chrome-hide-mobile ${scaleDemoPlaying ? "active" : ""}`}
            onClick={() => scaleDemoPlaying ? stopScaleDemo() : startScaleDemo()}
            title="Play scale demo"
          >
            {scaleDemoPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="1" y="1" width="4" height="10" />
                <rect x="7" y="1" width="4" height="10" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <polygon points="2,0 12,6 2,12" />
              </svg>
            )}
          </div>
        )}

        <div
          ref={noteLockRef}
          className={`chrome-cell chrome-toggle ${latchMode ? "active" : ""}`}
          onClick={() => {
            setLatchMode((v) => {
              if (v) clearLatch();
              return !v;
            });
            setNoteLockTooltip("");
          }}
          title="Note Lock — notes stay held (⇧L)"
        >
          Note lock <HotkeyBadge label="Shift+L" active={latchMode} />
          <Coachmark
            text={noteLockTooltip}
            visible={!!noteLockTooltip}
            duration={6000}
            onDismiss={() => setNoteLockTooltip("")}
          />
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
            <span className="settings-trigger" style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line className={`menu-line menu-top ${settingsOpen ? "open" : ""}`} x1="2" y1="5" x2="16" y2="5" />
                <line className={`menu-line menu-mid ${settingsOpen ? "open" : ""}`} x1="2" y1="9" x2="16" y2="9" />
                <line className={`menu-line menu-bot ${settingsOpen ? "open" : ""}`} x1="2" y1="13" x2="16" y2="13" />
              </svg>
            </span>
            <div className={`settings-backdrop ${settingsOpen ? "open" : ""}`} onClick={(e) => { e.stopPropagation(); setSettingsOpen(false); }} />
            <div className={`settings-popover ${settingsOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
                  <div className="settings-mobile-selects">
                    <div className="settings-mobile-row">
                      <span className="settings-mobile-label">
                        Input
                        <span className={`status-dot ${
                          cameraEnabled
                            ? (cameraStatus === "active" ? "connected" : cameraStatus === "requesting" || cameraStatus === "loading" ? "pending" : "denied")
                            : micEnabled
                              ? (micStatus === "active" ? "connected" : micStatus === "requesting" ? "pending" : "denied")
                              : (midiStatus.state === "connected" && midiStatus.deviceCount > 0 ? "connected"
                                : midiStatus.state === "pending" ? "pending" : "denied")
                        }`} />
                      </span>
                      <select
                        className="settings-mobile-select"
                        value={cameraEnabled ? "camera" : micEnabled ? "mic" : "keyboard"}
                        onChange={(e) => { const v = e.target.value; setMicEnabled(v === "mic"); setCameraEnabled(v === "camera"); if (v === "keyboard") setMidiRequested(true); e.target.blur(); }}
                      >
                        <option value="keyboard">Midi</option>
                        <option value="mic">Microphone</option>
                        <option value="camera">Camera</option>
                      </select>
                    </div>
                    <div className="settings-mobile-row">
                      <span className="settings-mobile-label">Key</span>
                      <select
                        className={`settings-mobile-select ${keyMode === "none" ? "inactive" : ""}`}
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
                        className={`settings-mobile-select ${!scaleMode ? "inactive" : ""}`}
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
                  <div className="settings-mobile-row">
                    <span className="settings-mobile-label">Sound</span>
                    <select
                      className="settings-mobile-select"
                      value={sound}
                      onChange={(e) => {
                        const val = e.target.value as SoundType;
                        setSound(val);
                        audio.setSound(val);
                        localStorage.setItem("sound", val);
                        e.target.blur();
                      }}
                    >
                      <option value="piano">Piano</option>
                      <option value="rhodes">Rhodes</option>
                      <option value="sawtooth">Sawtooth</option>
                    </select>
                  </div>
                  <button className="settings-item" onClick={() => setSuggestMode((v) => !v)}>
                    Suggestions <span className={`settings-check ${suggestMode ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={() => setShowHotkeys((v) => !v)}>
                    Hotkeys <span className={`settings-check ${showHotkeys ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={() => setShowRomanNumerals((v) => !v)}>
                    Numerals <span className={`settings-check ${showRomanNumerals ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={() => setShowNoteNames((v) => !v)}>
                    Note names <span className={`settings-check ${showNoteNames ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={() => setScrollLocked((v) => !v)}>
                    Lock keyboard <span className={`settings-check ${scrollLocked ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={() => setShowRipples((v) => !v)}>
                    Ripples <span className={`settings-check ${showRipples ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={() => setShowParticles((v) => !v)}>
                    Particles <span className={`settings-check ${showParticles ? "checked" : ""}`} />
                  </button>
                  <button className="settings-item" onClick={(e) => triggerThemeToggle(e)}>
                    Dark mode <span className={`settings-check ${darkMode ? "checked" : ""}`} />
                  </button>
                </div>
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
          <div className="chord-name-row" onClick={() => { const sel = window.getSelection(); if (!sel || sel.isCollapsed) replayChord(); }}>
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
              const variant: PillVariant = p.missing ? "missing"
                : hasScale ? (inScale ? "inScale" : "outScale")
                : "default";
              return (
                <NotePill key={p.key} label={p.label} variant={variant} />
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
          activeNoteNames={isMobile ? noteNames : undefined}
          scrollLocked={scrollLocked}
          onNoteOn={(n) => {
            handleNoteOn(n);
            if (!latchMode && splashChoice && splashChoice !== "keyboard" && !noteLockEnableShown.current) {
              noteLockEnableShown.current = true;
              setNoteLockTooltip("Enable Note Lock to keep notes held");
            }
          }}
          onNoteOff={handleNoteOff}
        />
      </div>

    </div>
  );
}
