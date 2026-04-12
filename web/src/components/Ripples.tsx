import { useRef, useEffect, useCallback } from "react";

interface RipplesProps {
  noteOnEvent: { note: number; velocity: number; id: number };
  chordSuffix: string;
  chordExact: boolean;
  darkMode: boolean;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  speed: number;
  lineWidth: number;
  opacity: number;
  hue: number;
  sat: number;
}

// Map MIDI note to horizontal position (0–1)
function noteToX(note: number): number {
  return Math.max(0.05, Math.min(0.95, (note - 21) / (108 - 21)));
}

// Same warmth spectrum as particles
function computeHue(suffix: string, exact: boolean): [number, number] {
  if (!exact && suffix !== "" && suffix !== "maj") return [0, 80]; // spicy red
  if (suffix.includes("dim") || suffix.includes("°") || suffix.includes("ø")) return [240, 60];
  if (suffix === "m" || suffix === "min") return [210, 65];
  if (suffix.startsWith("m") && !suffix.includes("maj")) return [195, 60];
  if (suffix.includes("sus")) return [160, 50];
  if (suffix.match(/7.*[b#]/)) return [15, 75];
  if (suffix.includes("aug") || suffix.includes("+")) return [320, 70];
  if (suffix === "7" || suffix === "9" || suffix === "11" || suffix === "13") return [30, 70];
  if (suffix.startsWith("maj")) return [45, 65];
  if (suffix === "" || suffix === "maj") return [50, 60];
  return [50, 60];
}

export default function Ripples({ noteOnEvent, chordSuffix, chordExact, darkMode }: RipplesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const animRef = useRef<number>(0);
  const prevEventIdRef = useRef(0);

  // Spawn ripple on each note-on
  useEffect(() => {
    if (noteOnEvent.id === 0 || noteOnEvent.id === prevEventIdRef.current) return;
    prevEventIdRef.current = noteOnEvent.id;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const [hue, sat] = computeHue(chordSuffix, chordExact);
    const vel = noteOnEvent.velocity / 127;
    const vel2 = vel * vel;

    const xCenter = noteToX(noteOnEvent.note);

    // Each note spawns 1-3 ripples depending on velocity
    const count = vel > 0.7 ? 3 : vel > 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      ripplesRef.current.push({
        x: rect.width * (xCenter + (Math.random() - 0.5) * 0.08),
        y: rect.height * (0.4 + (Math.random() - 0.5) * 0.2),
        radius: 3 + i * 8, // stagger starting radii
        speed: 0.6 + vel * 1.0 + i * 0.3,
        lineWidth: 1 + vel2 * 2.5,
        opacity: (0.15 + vel2 * 0.45) * (darkMode ? 1 : 0.8),
        hue,
        sat,
      });
    }
  }, [noteOnEvent, chordSuffix, chordExact, darkMode]);

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

    const w = rect.width;
    const h = rect.height;
    const ripples = ripplesRef.current;

    // Additive blending: overlapping ripples get brighter
    ctx.globalCompositeOperation = "lighter";

    // Draw ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += r.speed;
      r.opacity *= 0.993;
      r.lineWidth *= 0.999;

      if (r.opacity < 0.005 || r.radius > Math.max(w, h)) {
        ripples.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      const lightness = darkMode ? 55 : 45;
      ctx.strokeStyle = `hsla(${r.hue}, ${r.sat}%, ${lightness}%, ${r.opacity})`;
      ctx.lineWidth = r.lineWidth;
      ctx.stroke();
    }

    // Draw bright nodes at intersection points between nearby ripples
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < ripples.length; i++) {
      for (let j = i + 1; j < ripples.length; j++) {
        const a = ripples[i];
        const b = ripples[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check if the two circles intersect
        const rSum = a.radius + b.radius;
        const rDiff = Math.abs(a.radius - b.radius);
        if (dist > rSum || dist < rDiff || dist === 0) continue;

        // Compute intersection points
        const aa = (a.radius * a.radius - b.radius * b.radius + dist * dist) / (2 * dist);
        const hh = Math.sqrt(Math.max(0, a.radius * a.radius - aa * aa));
        const mx = a.x + (aa * dx) / dist;
        const my = a.y + (aa * dy) / dist;
        const px = (-dy * hh) / dist;
        const py = (dx * hh) / dist;

        const nodeOpacity = Math.min(a.opacity, b.opacity) * 1.5;
        if (nodeOpacity < 0.01) continue;

        const avgHue = (a.hue + b.hue) / 2;
        const lightness = darkMode ? 70 : 55;
        const nodeSize = 2 + Math.min(a.lineWidth, b.lineWidth);

        // Draw both intersection points
        for (const [ix, iy] of [[mx + px, my + py], [mx - px, my - py]]) {
          // Only draw if within canvas bounds
          if (ix < 0 || ix > w || iy < 0 || iy > h) continue;
          ctx.beginPath();
          ctx.arc(ix, iy, nodeSize, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${avgHue}, 80%, ${lightness}%, ${nodeOpacity})`;
          ctx.fill();
        }
      }
    }

    ctx.globalCompositeOperation = "source-over";
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
