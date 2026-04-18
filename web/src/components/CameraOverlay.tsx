import { useRef, useEffect } from "react";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { CAMERA_PRESS_Y } from "../lib/cameraEngine";

type Props = {
  video: HTMLVideoElement;
  landmarks: NormalizedLandmark[][] | null;
};

const FINGERTIPS = [4, 8, 12, 16, 20];

export default function CameraOverlay({ video, landmarks }: Props) {
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

      ctx.save();
      ctx.filter = "grayscale(100%)";
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();

      if (landmarks) {
        for (const hand of landmarks) {
          for (const tip of FINGERTIPS) {
            const lm = hand[tip];
            const pip = hand[tip - 2];
            const extended = lm.y < pip.y;
            if (!extended) continue;
            const x = (1 - lm.x) * w;
            const y = lm.y * h;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = lm.y > CAMERA_PRESS_Y ? "rgba(234, 179, 8, 0.8)" : "rgba(255, 255, 255, 0.5)";
            ctx.fill();
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [video, landmarks]);

  return <canvas ref={canvasRef} className="camera-overlay" />;
}
