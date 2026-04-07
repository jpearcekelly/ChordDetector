import { useRef, useEffect, useCallback } from "react";

interface ParticlesProps {
  activeNotes: Set<number>;
  noteOnEvent: { note: number; velocity: number; id: number }; // changes on every note-on
  chordSuffix: string; // e.g. "", "m", "7", "m7", "dim", "aug"
  chordExact: boolean; // true if a clean chord was detected
  darkMode: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  hue: number;
  life: number;
}

// Map MIDI note to horizontal position (0–1) across the keyboard range
function noteToX(note: number): number {
  return Math.max(0, Math.min(1, (note - 21) / (108 - 21)));
}

// Chord quality + exactness → hue on a warmth spectrum
// Cold/dark ──── Cool ──── Neutral ──── Warm ──── Spicy
// 240 blue      210       160 teal     30 orange  0 red
function computeHue(suffix: string, exact: boolean): number {
  // No clean chord detected — spicy red (dissonant cluster)
  if (!exact && suffix !== "") return 0;

  // Coldest → warmest by chord quality
  if (suffix.includes("dim") || suffix.includes("°") || suffix.includes("ø")) return 240;
  if (suffix === "m" || suffix === "min") return 210;
  if (suffix.startsWith("m") && !suffix.includes("maj")) return 195;
  if (suffix.includes("sus")) return 160;
  // Altered dominants — hot, approaching spicy
  if (suffix.match(/7.*[b#]/)) return 15;
  if (suffix.includes("aug") || suffix.includes("+")) return 320;
  // Dominant 7/9/11/13 — warmest clean chord
  if (suffix === "7" || suffix === "9" || suffix === "11" || suffix === "13") return 30;
  // Major 7 — warm and lush
  if (suffix.startsWith("maj")) return 45;
  // Plain major triad — warm
  if (suffix === "") return 50;
  // Fallback
  return 50;
}

export default function Particles({ activeNotes, noteOnEvent, chordSuffix, chordExact, darkMode }: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);
  const prevEventIdRef = useRef(0);

  // Spawn burst particles on every note-on event (including re-strikes over pedal)
  useEffect(() => {
    if (noteOnEvent.id === 0 || noteOnEvent.id === prevEventIdRef.current) return;
    prevEventIdRef.current = noteOnEvent.id;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hue = computeHue(chordSuffix, chordExact);
    const note = noteOnEvent.note;
    const vel = noteOnEvent.velocity / 127; // normalize 0–1
    const xCenter = noteToX(note);

    // Velocity dramatically scales visuals
    // pp (vel~0.05): 1-2 tiny faint particles
    // ff (vel~1.0): 12+ large bright particles that shoot upward
    const vel2 = vel * vel; // exponential curve — makes loud MUCH more dramatic
    const count = Math.max(1, Math.round((1 + activeNotes.size * 2) * vel2 + 1));
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        x: rect.width * (xCenter + (Math.random() - 0.5) * (0.05 + vel * 0.15)),
        y: rect.height * (0.7 + Math.random() * 0.25),
        vx: (Math.random() - 0.5) * (0.2 + vel2 * 1.5),
        vy: -(0.1 + vel2 * 1.5 + Math.random() * vel * 0.8),
        size: (1 + Math.random() * 1.5) * (0.3 + vel2 * 2.5),
        opacity: (darkMode ? 0.7 : 0.6) * (0.15 + vel2 * 0.85),
        hue,
        life: 0.6 + vel * 0.4, // loud particles live longer
      });
    }
  }, [noteOnEvent, activeNotes, chordSuffix, chordExact, darkMode]);

  // Continuously spawn ambient particles while notes are held
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeNotes.size === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const hue = computeHue(chordSuffix, chordExact);

      const notes = [...activeNotes];
      const note = notes[Math.floor(Math.random() * notes.length)];
      const xCenter = noteToX(note);

      particlesRef.current.push({
        x: rect.width * (xCenter + (Math.random() - 0.5) * 0.1),
        y: rect.height * (0.7 + Math.random() * 0.2),
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(0.2 + Math.random() * 0.5),
        size: 1.5 + Math.random() * 2,
        opacity: darkMode ? 0.35 : 0.25,
        hue,
        life: 1.0,
      });
    }, 150);
    return () => clearInterval(interval);
  }, [activeNotes, chordSuffix, darkMode]);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const particles = particlesRef.current;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.005;
      p.opacity *= 0.995;

      if (p.life <= 0 || p.opacity < 0.01) {
        particles.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 70%, ${darkMode ? 70 : 55}%, ${p.opacity * p.life})`;
      ctx.fill();
    }

    animRef.current = requestAnimationFrame(animate);
  }, [darkMode]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [animate]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
