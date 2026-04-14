import { useRef, useEffect, useCallback } from "react";
import { drawHotkeyBadge } from "./HotkeyBadge";
import { drawNotePill } from "./NotePill";
import type { PillVariant } from "./NotePill";

interface KeyboardProps {
  activeNotes: Set<number>;
  suggestedPitchClasses?: number[]; // pitch classes to highlight as ghost notes
  scalePitchClasses?: number[]; // pitch classes in the active scale
  hotkeyLabels?: Record<number, string>; // MIDI note → key label to show on keys
  noteNameLabels?: string[]; // 12-element array of note names indexed by pitch class (all keys)
  activeNoteNames?: string[]; // 12-element array — always shown on active keys regardless of noteNameLabels
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
const TOUCH_MIN_KEY_WIDTH = 52;

// Find the white key index of C4 (MIDI 60) for initial scroll centering
const C4_WHITE_IDX = MIDI_TO_WHITE_IDX.get(60) ?? 23;


export default function Keyboard({ activeNotes, suggestedPitchClasses = [], scalePitchClasses = [], hotkeyLabels, noteNameLabels, activeNoteNames, darkMode = true, scrollLocked = false, onNoteOn, onNoteOff }: KeyboardProps) {
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

    const MIN_KEY_WIDTH = isTouchDevice ? TOUCH_MIN_KEY_WIDTH : 40;
    if (isTouchDevice) {
      // Full 88 keys, scrollable
      visibleWhite = WHITE_KEYS;
      visibleBlack = BLACK_KEY_LIST;
    } else {
      // Desktop: fixed 4 octaves, C2 (36) to C6 (84)
      visibleWhite = WHITE_KEYS.filter(m => m >= 36 && m <= 84);
      visibleBlack = BLACK_KEY_LIST.filter(bk => bk.midi >= 36 && bk.midi <= 84);
    }
    canvasW = Math.max(visibleWhite.length * MIN_KEY_WIDTH, containerWidth);

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

    // Create cross-hatch pattern for out-of-scale keys
    let hatchPattern: CanvasPattern | null = null;
    let hatchPatternDark: CanvasPattern | null = null;
    if (scaleSet.size > 0) {
      const size = 8 * dpr;
      const lw = 0.5;
      const makeHatch = (bg: string, lineColor: string) => {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const h = c.getContext("2d")!;
        h.fillStyle = bg;
        h.fillRect(0, 0, size, size);
        h.strokeStyle = lineColor;
        h.lineWidth = lw;
        // Three segments to ensure seamless tiling at edges
        h.beginPath();
        h.moveTo(-1, size + 1);
        h.lineTo(size + 1, -1);
        h.moveTo(-1, 1);
        h.lineTo(1, -1);
        h.moveTo(size - 1, size + 1);
        h.lineTo(size + 1, size - 1);
        h.stroke();
        return ctx.createPattern(c, "repeat");
      };
      hatchPattern = makeHatch("#ffffff", "#000000");
      hatchPatternDark = makeHatch("#1a1a1a", "rgba(255,255,255,0.2)");
    }

    // Offset to translate global white-key indices to local ones
    const globalOffset = MIDI_TO_WHITE_IDX.get(visibleWhite[0]) ?? 0;

    // ── Pass 1: White key fills ──
    for (let i = 0; i < numWhite; i++) {
      const midi = visibleWhite[i];
      const isActive = activeNotes.has(midi);
      const isSuggested = !isActive && suggestedSet.has(midi % 12);
      const isOutOfScale = scaleSet.size > 0 && !scaleSet.has(midi % 12);
      const x = i * wkw;

      const hasScale = scaleSet.size > 0;
      const inScale = hasScale && scaleSet.has(midi % 12);
      if (isActive) {
        ctx.fillStyle = hasScale
          ? (inScale ? "#22c55e" : "#ef4444")
          : "#eab308";
      } else if (isSuggested) {
        ctx.fillStyle = darkMode ? "#2e2a1f" : "#faf5eb";
      } else if (isOutOfScale) {
        const pat = darkMode ? hatchPatternDark : hatchPattern;
        ctx.fillStyle = pat || (darkMode ? "#2a2a2a" : "#d0d0d0");
      } else {
        ctx.fillStyle = darkMode ? "#ffffff" : "#ffffff";
      }
      const x2 = Math.round((i + 1) * wkw);
      ctx.fillRect(Math.round(x), 0, x2 - Math.round(x), h);
    }

    // ── Pass 2: Hairline separators + top border ──
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = 1;
    // Top border line
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(w, 0.5);
    ctx.stroke();
    // Key separators
    for (let i = 1; i < numWhite; i++) {
      const x = Math.round(i * wkw) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // ── Pass 3: White key labels (below black key zone) ──
    for (let i = 0; i < numWhite; i++) {
      const midi = visibleWhite[i];
      const isActive = activeNotes.has(midi);
      const isOutOfScale = scaleSet.size > 0 && !scaleSet.has(midi % 12);
      const x = i * wkw;

      const octave = Math.floor(midi / 12) - 1;

      // Note name with octave at the bottom — replaces C labels when noteNameLabels is on
      if (noteNameLabels && !isOutOfScale) {
        const label = `${noteNameLabels[midi % 12]}${octave}`;
        ctx.fillStyle = isActive
          ? (darkMode ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.5)")
          : (darkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.18)");
        ctx.font = `500 ${Math.min(9, wkw * 0.35)}px "Space Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText(label, x + wkw / 2, h - 6);
      } else if (!noteNameLabels && midi % 12 === 0 && !isOutOfScale) {
        // C labels only when note names are off
        const label = `C${octave}`;
        ctx.fillStyle = darkMode ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
        ctx.font = `500 ${Math.min(9, wkw * 0.35)}px "Space Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText(label, x + wkw / 2, h - 6);
      }

      // Hotkey badge
      if (hotkeyLabels && hotkeyLabels[midi] && !isOutOfScale) {
        const bx = x + wkw / 2;
        const by = bkh + (h - bkh) * 0.45;
        drawHotkeyBadge(ctx, hotkeyLabels[midi], bx, by, Math.min(wkw * 0.65, 22), Math.min(wkw * 0.45, 16), darkMode ? "dark" : "light", isActive);
      }

      // Mobile-only: draw note pill on active keys when activeNoteNames is set
      if (isActive && activeNoteNames && !noteNameLabels) {
        const names = activeNoteNames;
        const pillLabel = `${names[midi % 12]}${octave}`;
        const pillR = Math.min(wkw * 0.35, 16);
        const scSet = new Set(scalePitchClasses);
        const variant: PillVariant = scSet.size > 0
          ? (scSet.has(midi % 12) ? "inScale" : "outScale")
          : "default";
        drawNotePill(ctx, pillLabel, x + wkw / 2, bkh + (h - bkh) * 0.5, pillR, variant);
      }
    }

    // ── Pass 4: Black keys ──
    for (const bk of visibleBlack) {
      const { midi, xPos } = bk;
      const localXPos = xPos - globalOffset;

      const isActive = activeNotes.has(midi);
      const isSuggested = !isActive && suggestedSet.has(midi % 12);
      const isOutOfScale = scaleSet.size > 0 && !scaleSet.has(midi % 12);
      const x = localXPos * wkw - bkw / 2;

      const hasScale = scaleSet.size > 0;
      const inScale = hasScale && scaleSet.has(midi % 12);
      if (isActive) {
        ctx.fillStyle = hasScale
          ? (inScale ? "#22c55e" : "#ef4444")
          : "#eab308";
        ctx.fillRect(x, 0, bkw, bkh);
      } else if (isSuggested) {
        ctx.fillStyle = darkMode ? "#4a4230" : "#8a7a50";
        ctx.fillRect(x, 0, bkw, bkh);
      } else if (isOutOfScale) {
        const pat = darkMode ? hatchPatternDark : hatchPattern;
        ctx.fillStyle = pat || (darkMode ? "#2a2a2a" : "#d0d0d0");
        ctx.fillRect(x, 0, bkw, bkh);
      } else {
        ctx.fillStyle = darkMode ? "#1a1a1a" : "#111111";
        ctx.fillRect(x, 0, bkw, bkh);
      }

      // Black key outline — left, bottom, right (no top, so it overlaps the top border cleanly)
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, bkh - 0.5);
      ctx.lineTo(x + bkw - 0.5, bkh - 0.5);
      ctx.lineTo(x + bkw - 0.5, 0);
      ctx.stroke();

      // Hotkey badge — use light variant when active (bright color bg), onDark when inactive (black bg)
      if (hotkeyLabels && hotkeyLabels[midi] && !isOutOfScale) {
        const bx = x + bkw / 2;
        const by = bkh * 0.55;
        const variant = isActive ? (darkMode ? "dark" : "light") : "onDark";
        drawHotkeyBadge(ctx, hotkeyLabels[midi], bx, by, Math.min(bkw * 0.75, 20), Math.min(bkw * 0.5, 14), variant, isActive);
      }

      const octave = Math.floor(midi / 12) - 1;

      // Note name with octave at the bottom
      if (noteNameLabels && !isOutOfScale) {
        const label = `${noteNameLabels[midi % 12]}${octave}`;
        ctx.fillStyle = isActive ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.35)";
        ctx.font = `500 ${Math.min(9, bkw * 0.35)}px "Space Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText(label, x + bkw / 2, bkh - 6);
      }

      // Mobile-only: draw note pill on active keys
      if (isActive && activeNoteNames && !noteNameLabels) {
        const pillLabel = `${activeNoteNames[midi % 12]}${octave}`;
        const pillR = Math.min(bkw * 0.35, 13);
        const scSet = new Set(scalePitchClasses);
        const variant: PillVariant = scSet.size > 0
          ? (scSet.has(midi % 12) ? "inScale" : "outScale")
          : "default";
        drawNotePill(ctx, pillLabel, x + bkw / 2, bkh * 0.5, pillR, variant);
      }
    }

    // Save for hit-testing
    visibleStateRef.current = { white: visibleWhite, black: visibleBlack };
  }, [activeNotes, suggestedPitchClasses, scalePitchClasses, hotkeyLabels, noteNameLabels, activeNoteNames, darkMode]);

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
      className={`keyboard-scroll scrollable ${scrollLocked ? "scroll-locked" : ""}`}
    >
      <canvas
        ref={canvasRef}
        className="keyboard-canvas"
        style={{ cursor: "pointer", touchAction: isTouchDevice && !scrollLocked ? "pan-x" : "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}
