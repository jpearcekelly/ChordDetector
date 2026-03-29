import { useRef, useEffect, useCallback } from "react";

interface KeyboardProps {
  activeNotes: Set<number>;
  suggestedPitchClasses?: number[]; // pitch classes to highlight as ghost notes
  onNoteOn?: (note: number) => void;
  onNoteOff?: (note: number) => void;
}

const START_OCTAVE = 3;
const NUM_OCTAVES = 4;
const WHITE_KEY_PITCHES = [0, 2, 4, 5, 7, 9, 11];
// xFrac = position in white-key-widths from start of octave.
// Each black key sits between two white keys: e.g. C# between C (0) and D (1).
const BLACK_KEYS: { pitch: number; xFrac: number }[] = [
  { pitch: 1, xFrac: 1.0 },   // C# — between C(0) and D(1)
  { pitch: 3, xFrac: 2.0 },   // D# — between D(1) and E(2)
  { pitch: 6, xFrac: 4.0 },   // F# — between F(3) and G(4)
  { pitch: 8, xFrac: 5.0 },   // G# — between G(4) and A(5)
  { pitch: 10, xFrac: 6.0 },  // A# — between A(5) and B(6)
];

function midiForWhiteIndex(i: number): number {
  const octave = Math.floor(i / 7);
  if (octave >= NUM_OCTAVES) return (START_OCTAVE + NUM_OCTAVES) * 12;
  return (START_OCTAVE + octave) * 12 + WHITE_KEY_PITCHES[i % 7];
}

const TOTAL_WHITE_KEYS = NUM_OCTAVES * 7 + 1;

export default function Keyboard({ activeNotes, suggestedPitchClasses = [], onNoteOn, onNoteOff }: KeyboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pressedRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const wkw = w / TOTAL_WHITE_KEYS;
    const bkw = wkw * 0.62;
    const bkh = h * 0.62;

    ctx.clearRect(0, 0, w, h);

    const suggestedSet = new Set(suggestedPitchClasses);

    // White keys
    for (let i = 0; i < TOTAL_WHITE_KEYS; i++) {
      const midi = midiForWhiteIndex(i);
      const isActive = activeNotes.has(midi);
      const isSuggested = !isActive && suggestedSet.has(midi % 12);
      const x = i * wkw;

      if (isActive) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.55)";
      } else if (isSuggested) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      } else {
        ctx.fillStyle = "#ffffff";
      }
      ctx.beginPath();
      ctx.roundRect(x + 0.5, 0.5, wkw - 1, h - 1, 4);
      ctx.fill();

      // Draw a subtle dot on suggested white keys
      if (isSuggested) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
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
        ctx.font = "500 9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, x + wkw / 2, h - 6);
      }
    }

    // Black keys
    for (let octave = 0; octave < NUM_OCTAVES; octave++) {
      for (const bk of BLACK_KEYS) {
        const midi = (START_OCTAVE + octave) * 12 + bk.pitch;
        const isActive = activeNotes.has(midi);
        const isSuggested = !isActive && suggestedSet.has(midi % 12);
        const x = (octave * 7 + bk.xFrac) * wkw - bkw / 2;

        if (isActive) {
          ctx.fillStyle = "rgb(59, 130, 246)";
        } else if (isSuggested) {
          ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
        } else {
          ctx.fillStyle = "#1a1a1a";
        }
        ctx.beginPath();
        ctx.roundRect(x, 0, bkw, bkh, 3);
        ctx.fill();

        // Dot on suggested black keys
        if (isSuggested) {
          ctx.fillStyle = "rgba(59, 130, 246, 0.4)";
          ctx.beginPath();
          ctx.arc(x + bkw / 2, bkh * 0.75, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, [activeNotes, suggestedPitchClasses]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  // Hit-test: which MIDI note is at (x, y)?
  const hitTest = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const wkw = w / TOTAL_WHITE_KEYS;
    const bkw = wkw * 0.62;
    const bkh = h * 0.62;

    // Check black keys first (they're on top)
    if (y < bkh) {
      for (let octave = 0; octave < NUM_OCTAVES; octave++) {
        for (const bk of BLACK_KEYS) {
          const midi = (START_OCTAVE + octave) * 12 + bk.pitch;
          const bx = (octave * 7 + bk.xFrac) * wkw - bkw / 2;
          if (x >= bx && x <= bx + bkw) return midi;
        }
      }
    }

    // White keys
    const i = Math.floor(x / wkw);
    if (i >= 0 && i < TOTAL_WHITE_KEYS) return midiForWhiteIndex(i);
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
        // Release the previous note, play the new one
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
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "160px", cursor: "pointer", borderRadius: 6, touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
}
