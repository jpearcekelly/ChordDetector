import { useRef, useEffect } from "react";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

type Props = {
  landmarks: NormalizedLandmark[][] | null;
  knobAngle?: number;
  knobEngaged?: boolean;
  knobX?: number;
  knobY?: number;
  knobRadius?: number;
};

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const FINGERTIPS = [4, 8, 12, 16, 20];

export default function CameraOverlay({ landmarks, knobAngle = 1, knobEngaged = false, knobX = 0.18, knobY = 0.45, knobRadius = 0.10 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);

      // Draw knob
      drawKnob(ctx, w, h);

      if (!landmarks) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      for (const hand of landmarks) {
        const toX = (lm: NormalizedLandmark) => (1 - lm.x) * w;
        const toY = (lm: NormalizedLandmark) => lm.y * h;

        ctx.strokeStyle = "rgba(180, 130, 0, 0.45)";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        for (const [a, b] of CONNECTIONS) {
          ctx.beginPath();
          ctx.moveTo(toX(hand[a]), toY(hand[a]));
          ctx.lineTo(toX(hand[b]), toY(hand[b]));
          ctx.stroke();
        }

        for (let i = 0; i < hand.length; i++) {
          const lm = hand[i];
          const isTip = FINGERTIPS.includes(i);
          ctx.beginPath();
          ctx.arc(toX(lm), toY(lm), isTip ? 6 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isTip
            ? "rgba(234, 179, 8, 0.9)"
            : "rgba(180, 130, 0, 0.55)";
          ctx.fill();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    function drawKnob(ctx: CanvasRenderingContext2D, w: number, h: number) {
      const cx = knobX * w;
      const cy = knobY * h;
      const r = knobRadius * Math.min(w, h) * 0.6;

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = knobEngaged
        ? "rgba(234, 179, 8, 0.7)"
        : "rgba(180, 130, 0, 0.2)";
      ctx.lineWidth = knobEngaged ? 3 : 2;
      ctx.stroke();

      // Fill
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
      ctx.fillStyle = knobEngaged
        ? "rgba(234, 179, 8, 0.12)"
        : "rgba(180, 130, 0, 0.05)";
      ctx.fill();

      // Indicator line — rotates with knobAngle (0..1 maps to ~7 o'clock to ~5 o'clock)
      const startAngle = Math.PI * 0.75;
      const endAngle = Math.PI * 2.25;
      const angle = startAngle + knobAngle * (endAngle - startAngle);
      const innerR = r * 0.3;
      const outerR = r * 0.85;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      ctx.strokeStyle = knobEngaged
        ? "rgba(234, 179, 8, 0.9)"
        : "rgba(180, 130, 0, 0.35)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.stroke();

      // Arc track showing range
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, startAngle, endAngle);
      ctx.strokeStyle = "rgba(180, 130, 0, 0.1)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Arc fill showing current value
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, startAngle, angle);
      ctx.strokeStyle = knobEngaged
        ? "rgba(234, 179, 8, 0.6)"
        : "rgba(234, 179, 8, 0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = knobEngaged
        ? "rgba(234, 179, 8, 0.8)"
        : "rgba(180, 130, 0, 0.25)";
      ctx.font = "500 10px 'Space Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("FILTER", cx, cy + r + 18);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [landmarks, knobAngle, knobEngaged, knobX, knobY, knobRadius]);

  return <canvas ref={canvasRef} className="camera-overlay" />;
}
