import { useRef, useEffect, useCallback, useState } from "react";

interface KeyboardProps {
  activeNotes: Set<number>;
  suggestedPitchClasses?: number[]; // pitch classes to highlight as ghost notes
  hotkeyLabels?: Record<number, string>; // MIDI note → key label to show on keys
  noteNameLabels?: string[]; // 12-element array of note names indexed by pitch class
  darkMode?: boolean;
  onNoteOn?: (note: number) => void;
  onNoteOff?: (note: number) => void;
}

const WHITE_KEY_PITCHES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEYS: { pitch: number; xFrac: number }[] = [
  { pitch: 1, xFrac: 1.0 },
  { pitch: 3, xFrac: 2.0 },
  { pitch: 6, xFrac: 4.0 },
  { pitch: 8, xFrac: 5.0 },
  { pitch: 10, xFrac: 6.0 },
];

function getLayout(width: number) {
  // 2 octaves on narrow screens (<600px), 4 on wide
  // startOctave is MIDI octave: MIDI octave 4 = C3, octave 5 = C4
  if (width < 500) {
    return { startOctave: 5, numOctaves: 2 }; // C4–C6
  } else if (width < 800) {
    return { startOctave: 4, numOctaves: 3 }; // C3–C6
  }
  return { startOctave: 4, numOctaves: 4 };   // C3–C7
}

export default function Keyboard({ activeNotes, suggestedPitchClasses = [], hotkeyLabels, noteNameLabels, darkMode = true, onNoteOn, onNoteOff }: KeyboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pressedRef = useRef<number | null>(null);
  const [layout, setLayout] = useState(() => getLayout(typeof window !== "undefined" ? window.innerWidth : 1200));

  const { startOctave, numOctaves } = layout;
  const totalWhiteKeys = numOctaves * 7 + 1;

  function midiForWhiteIndex(i: number): number {
    const octave = Math.floor(i / 7);
    if (octave >= numOctaves) return (startOctave + numOctaves) * 12;
    return (startOctave + octave) * 12 + WHITE_KEY_PITCHES[i % 7];
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Update layout based on current width
    const newLayout = getLayout(rect.width);
    if (newLayout.numOctaves !== numOctaves || newLayout.startOctave !== startOctave) {
      setLayout(newLayout);
      return; // will re-render and redraw
    }

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const wkw = w / totalWhiteKeys;
    const bkw = wkw * 0.62;
    const bkh = h * 0.62;

    ctx.clearRect(0, 0, w, h);

    const suggestedSet = new Set(suggestedPitchClasses);

    // White keys
    for (let i = 0; i < totalWhiteKeys; i++) {
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

    // Black keys
    for (let octave = 0; octave < numOctaves; octave++) {
      for (const bk of BLACK_KEYS) {
        const midi = (startOctave + octave) * 12 + bk.pitch;
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
    }
  }, [activeNotes, suggestedPitchClasses, hotkeyLabels, noteNameLabels, darkMode, numOctaves, startOctave, totalWhiteKeys]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  // Hit-test
  const hitTest = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const wkw = w / totalWhiteKeys;
    const bkw = wkw * 0.62;
    const bkh = h * 0.62;

    if (y < bkh) {
      for (let octave = 0; octave < numOctaves; octave++) {
        for (const bk of BLACK_KEYS) {
          const midi = (startOctave + octave) * 12 + bk.pitch;
          const bx = (octave * 7 + bk.xFrac) * wkw - bkw / 2;
          if (x >= bx && x <= bx + bkw) return midi;
        }
      }
    }

    const i = Math.floor(x / wkw);
    if (i >= 0 && i < totalWhiteKeys) return midiForWhiteIndex(i);
    return null;
  }, [numOctaves, startOctave, totalWhiteKeys]);

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
