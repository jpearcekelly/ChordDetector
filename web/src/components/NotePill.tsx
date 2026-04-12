// Shared note pill — React component for chord display, canvas helper for Keyboard.
//
// Visual spec: circle with centered monospace text.
// Variants: default (gold), in-scale (green), out-scale (red), missing (dashed outline).

// ── Shared constants ────────────────────────────
export const PILL = {
  font: '"Space Mono", monospace',
  fontWeight: 600,
  colors: {
    default: { bg: "rgba(212, 168, 67, 0.15)", text: "#96752e", border: "rgba(150, 117, 46, 0.3)" },
    inScale: { bg: "rgba(45, 138, 78, 0.15)", text: "#1a6b3a", border: "rgba(45, 138, 78, 0.3)" },
    outScale: { bg: "rgba(196, 64, 64, 0.12)", text: "#a03030", border: "rgba(196, 64, 64, 0.3)" },
    missing: { bg: "transparent", text: "rgba(0,0,0,0.35)", border: "rgba(0,0,0,0.2)" },
  },
} as const;

export type PillVariant = "default" | "inScale" | "outScale" | "missing";

// ── Canvas drawing helper ───────────────────────
export function drawNotePill(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  radius: number,
  variant: PillVariant = "default",
) {
  const colors = PILL.colors[variant];

  // Background circle
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Border
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  if (variant === "missing") {
    ctx.setLineDash([2, 2]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Text
  ctx.fillStyle = colors.text;
  ctx.font = `${PILL.fontWeight} ${Math.round(radius * 0.7)}px ${PILL.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
  ctx.textBaseline = "alphabetic";
}

// ── React component ─────────────────────────────
interface NotePillProps {
  label: string;
  variant?: PillVariant;
}

export default function NotePill({ label, variant = "default" }: NotePillProps) {
  const className = variant === "inScale" ? "pill in-scale"
    : variant === "outScale" ? "pill out-scale"
    : variant === "missing" ? "pill missing"
    : "pill";
  return (
    <span className={className}>
      {label}
    </span>
  );
}
