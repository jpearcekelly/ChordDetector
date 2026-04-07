import { useRef, useEffect, useCallback } from "react";

interface KeyboardProps {
  activeNotes: Set<number>;
  suggestedPitchClasses?: number[]; // pitch classes to highlight as ghost notes
  scalePitchClasses?: number[]; // pitch classes in the active scale
  hotkeyLabels?: Record<number, string>; // MIDI note → key label to show on keys
  noteNameLabels?: string[]; // 12-element array of note names indexed by pitch class
  darkMode?: boolean;
  scrollLocked?: boolean;
  onNoteOn?: (note: number) => void;
  onNoteOff?: (note: number) => void;
}

// ── 88-key piano layout: A0 (MIDI 21) to C8 (MIDI 108) ──
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const MIDI_LOW = 21;  // A0
const MIDI_HIGH = 108; // C8

// Precompute white key MIDI notes (52 total)
const WHITE_KEYS: number[] = [];
for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
  if (WHITE_PCS.has(m % 12)) WHITE_KEYS.push(m);
}

// Map MIDI note → white key index for quick lookup
const MIDI_TO_WHITE_IDX = new Map<number, number>();
WHITE_KEYS.forEach((m, i) => MIDI_TO_WHITE_IDX.set(m, i));

// Black key x-positions within each octave (in white-key-width units from octave start)
// These match the standard piano layout where black keys sit at the boundary of white keys
const BLACK_KEY_OFFSETS: Record<number, number> = {
  1: 1.0,   // C#/Db — between C and D
  3: 2.0,   // D#/Eb — between D and E
  6: 4.0,   // F#/Gb — between F and G
  8: 5.0,   // G#/Ab — between G and A
  10: 6.0,  // A#/Bb — between A and B
};

// Precompute black key positions in global white-key-index units
const BLACK_KEY_LIST: { midi: number; xPos: number }[] = [];
for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
  const pc = m % 12;
  if (WHITE_PCS.has(pc)) continue;
  const offset = BLACK_KEY_OFFSETS[pc];
  if (offset === undefined) continue;
  // Find the C at the start of this MIDI octave
  const octaveMidi = m - pc; // e.g. for C#4 (61), this is C4 (60)
  const octaveWhiteIdx = MIDI_TO_WHITE_IDX.get(octaveMidi);
  if (octaveWhiteIdx !== undefined) {
    BLACK_KEY_LIST.push({ midi: m, xPos: octaveWhiteIdx + offset });
  } else {
    // Edge case: Bb0 — octave C is below the piano. Position relative to A0 (index 0)
    // A0 is white index 0, Bb0 sits between A0 and B0, so xPos = 0.5
    const leftIdx = MIDI_TO_WHITE_IDX.get(m - 1);
    const rightIdx = MIDI_TO_WHITE_IDX.get(m + 1);
    if (leftIdx !== undefined && rightIdx !== undefined) {
      BLACK_KEY_LIST.push({ midi: m, xPos: (leftIdx + rightIdx) / 2 });
    }
  }
}

const TOTAL_WHITE = WHITE_KEYS.length; // 52

const isTouchDevice = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
const TOUCH_MIN_KEY_WIDTH = 44;

// Find the white key index of C4 (MIDI 60) for initial scroll centering
const C4_WHITE_IDX = MIDI_TO_WHITE_IDX.get(60) ?? 23;


export default function Keyboard({ activeNotes, suggestedPitchClasses = [], scalePitchClasses = [], hotkeyLabels, noteNameLabels, darkMode = true, scrollLocked = false, onNoteOn, onNoteOff }: KeyboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pressedRef = useRef<number | null>(null);
  const hasScrolledRef = useRef(false);
  // Store current visible keys for hit-testing
  const visibleStateRef = useRef({ white: WHITE_KEYS, black: BLACK_KEY_LIST });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const container = scrollRef.current;
    const containerWidth = container ? container.clientWidth : canvas.getBoundingClientRect().width;

    // Touch: all 88 keys, scrollable with minimum key width
    // Desktop: subset that fits the window
    let visibleWhite: number[];
    let visibleBlack: typeof BLACK_KEY_LIST;
    let canvasW: number;

    if (isTouchDevice) {
      // Full 88 keys, scrollable
      visibleWhite = WHITE_KEYS;
      visibleBlack = BLACK_KEY_LIST;
      canvasW = Math.max(TOTAL_WHITE * TOUCH_MIN_KEY_WIDTH, containerWidth);
    } else {
      // Desktop: fixed 4 octaves, C2 (36) to C6 (84)
      visibleWhite = WHITE_KEYS.filter(m => m >= 36 && m <= 84);
      visibleBlack = BLACK_KEY_LIST.filter(bk => bk.midi >= 36 && bk.midi <= 84);
      canvasW = containerWidth;
    }

    const numWhite = visibleWhite.length;
    const rect = canvas.getBoundingClientRect();
    const h = rect.height;

    canvas.style.width = canvasW > containerWidth ? `${canvasW}px` : "100%";
    canvas.width = canvasW * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const w = canvasW;
    const wkw = w / numWhite;
    const bkw = wkw * 0.62;
    const bkh = h * 0.62;

    ctx.clearRect(0, 0, w, h);

    const suggestedSet = new Set(suggestedPitchClasses);
    const scaleSet = new Set(scalePitchClasses);

    // Offset to translate global white-key indices to local ones
    const globalOffset = MIDI_TO_WHITE_IDX.get(visibleWhite[0]) ?? 0;

    // White keys
    for (let i = 0; i < numWhite; i++) {
      const midi = visibleWhite[i];
      const isActive = activeNotes.has(midi);
      const isSuggested = !isActive && suggestedSet.has(midi % 12);
      const isOutOfScale = scaleSet.size > 0 && !scaleSet.has(midi % 12);
      const x = i * wkw;

      if (isActive) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.55)";
      } else if (isSuggested) {
        ctx.fillStyle = darkMode ? "rgba(200, 210, 255, 0.85)" : "rgba(59, 130, 246, 0.12)";
      } else if (isOutOfScale) {
        ctx.fillStyle = darkMode ? "#b8b8c0" : "#d4d4d8";
      } else {
        ctx.fillStyle = darkMode ? "#ffffff" : "#fcfcfc";
      }
      ctx.beginPath();
      ctx.roundRect(x + 0.5, 0.5, wkw - 1, h - 1, 4);
      ctx.fill();

      if (isSuggested) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.35)";
        ctx.beginPath();
        ctx.arc(x + wkw / 2, h * 0.75, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = "rgba(128, 128, 128, 0.35)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Label C notes
      if (midi % 12 === 0) {
        const label = `C${Math.floor(midi / 12) - 1}`;
        ctx.fillStyle = isActive ? "#ffffff" : "#999999";
        ctx.font = `500 ${Math.min(9, wkw * 0.35)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(label, x + wkw / 2, h - 6);
      }

      // Hotkey badge
      if (hotkeyLabels && hotkeyLabels[midi]) {
        const label = hotkeyLabels[midi];
        const bx = x + wkw / 2;
        const by = bkh + (h - bkh) * 0.45;
        const badgeSize = Math.min(wkw * 0.55, 18);
        const radius = 3;

        ctx.fillStyle = isActive ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.07)";
        ctx.beginPath();
        ctx.roundRect(bx - badgeSize / 2, by - badgeSize / 2, badgeSize, badgeSize, radius);
        ctx.fill();
        ctx.strokeStyle = isActive ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.12)";
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.fillStyle = isActive ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.3)";
        ctx.font = `600 ${Math.round(badgeSize * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, bx, by);
        ctx.textBaseline = "alphabetic";
      }

      // Note name label on white keys
      if (noteNameLabels) {
        const noteName = noteNameLabels[midi % 12];
        ctx.fillStyle = isActive ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.2)";
        ctx.font = `500 ${Math.min(10, wkw * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(noteName, x + wkw / 2, h - 18);
      }

    }

    // Black keys — use precomputed global xPos, shifted by the offset
    for (const bk of visibleBlack) {
      const { midi, xPos } = bk;
      const localXPos = xPos - globalOffset;

      const isActive = activeNotes.has(midi);
      const isSuggested = !isActive && suggestedSet.has(midi % 12);
      const isOutOfScale = scaleSet.size > 0 && !scaleSet.has(midi % 12);
      const x = localXPos * wkw - bkw / 2;

      if (isActive) {
        ctx.fillStyle = "rgb(59, 130, 246)";
      } else if (isSuggested) {
        ctx.fillStyle = darkMode ? "rgba(59, 130, 246, 0.25)" : "rgba(59, 130, 246, 0.4)";
      } else if (isOutOfScale) {
        ctx.fillStyle = darkMode ? "#555560" : "#8a8a90";
      } else {
        ctx.fillStyle = darkMode ? "#1a1a1a" : "#2a2a2a";
      }
      ctx.beginPath();
      ctx.roundRect(x, 0, bkw, bkh, 3);
      ctx.fill();

      if (isSuggested) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.4)";
        ctx.beginPath();
        ctx.arc(x + bkw / 2, bkh * 0.75, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hotkey badge
      if (hotkeyLabels && hotkeyLabels[midi]) {
        const label = hotkeyLabels[midi];
        const bx = x + bkw / 2;
        const by = bkh * 0.55;
        const badgeSize = Math.min(bkw * 0.65, 16);
        const radius = 3;

        ctx.fillStyle = isActive ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.roundRect(bx - badgeSize / 2, by - badgeSize / 2, badgeSize, badgeSize, radius);
        ctx.fill();
        ctx.strokeStyle = isActive ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)";
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.fillStyle = isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)";
        ctx.font = `600 ${Math.round(badgeSize * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, bx, by);
        ctx.textBaseline = "alphabetic";
      }

      // Note name label on black keys
      if (noteNameLabels) {
        const noteName = noteNameLabels[midi % 12];
        ctx.fillStyle = isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)";
        ctx.font = `500 ${Math.min(9, bkw * 0.35)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(noteName, x + bkw / 2, bkh - 6);
      }

    }

    // Save for hit-testing
    visibleStateRef.current = { white: visibleWhite, black: visibleBlack };
  }, [activeNotes, suggestedPitchClasses, scalePitchClasses, hotkeyLabels, noteNameLabels, darkMode]);

  // Scroll to center on middle C (C4) on first render
  useEffect(() => {
    if (hasScrolledRef.current) return;
    const container = scrollRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    // Only scroll if content overflows
    if (container.scrollWidth <= container.clientWidth) return;

    hasScrolledRef.current = true;
    const canvasW = canvas.getBoundingClientRect().width;
    const wkw = canvasW / TOTAL_WHITE;
    const c4Offset = C4_WHITE_IDX * wkw;
    container.scrollLeft = c4Offset - container.clientWidth / 2 + wkw / 2;
  }, [draw]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  // Hit-test
  const hitTest = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { white: vWhite, black: vBlack } = visibleStateRef.current;
    const numW = vWhite.length;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const wkw = w / numW;
    const bkw = wkw * 0.62;
    const bkh = h * 0.62;

    if (y < bkh) {
      const offset = MIDI_TO_WHITE_IDX.get(vWhite[0]) ?? 0;
      for (const bk of vBlack) {
        const bx = (bk.xPos - offset) * wkw - bkw / 2;
        if (x >= bx && x <= bx + bkw) return bk.midi;
      }
    }

    const i = Math.floor(x / wkw);
    if (i >= 0 && i < numW) return vWhite[i];
    return null;
  }, []);

  const isDraggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDraggingRef.current = true;
      const note = hitTest(e.clientX, e.clientY);
      if (note !== null) {
        pressedRef.current = note;
        onNoteOn?.(note);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [hitTest, onNoteOn],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      const note = hitTest(e.clientX, e.clientY);
      if (note !== null && note !== pressedRef.current) {
        if (pressedRef.current !== null) {
          onNoteOff?.(pressedRef.current);
        }
        pressedRef.current = note;
        onNoteOn?.(note);
      }
    },
    [hitTest, onNoteOn, onNoteOff],
  );

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    if (pressedRef.current !== null) {
      onNoteOff?.(pressedRef.current);
      pressedRef.current = null;
    }
  }, [onNoteOff]);

  return (
    <div
      ref={scrollRef}
      className={`keyboard-scroll ${isTouchDevice ? "scrollable" : ""} ${scrollLocked ? "scroll-locked" : ""}`}
    >
      <canvas
        ref={canvasRef}
        className="keyboard-canvas"
        style={{ cursor: "pointer", borderRadius: 6, touchAction: isTouchDevice && !scrollLocked ? "pan-x" : "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}
