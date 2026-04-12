// Shared hotkey badge — React component for DOM, canvas helper for Keyboard
//
// Visual spec: rounded-rect outline with centered monospace text.
// Inactive: grey border + grey text. Active: black border + black text.

// ── Shared constants ────────────────────────────
export const BADGE = {
  font: '"Space Mono", monospace',
  fontWeight: 500,
  borderRadius: 3,
  light: {
    border: "rgba(0, 0, 0, 0.2)",
    text: "rgba(0, 0, 0, 0.3)",
    borderActive: "rgba(0, 0, 0, 1)",
    textActive: "rgba(0, 0, 0, 1)",
  },
  dark: {
    border: "rgba(255, 255, 255, 0.15)",
    text: "rgba(255, 255, 255, 0.25)",
    borderActive: "rgba(255, 255, 255, 0.6)",
    textActive: "rgba(255, 255, 255, 0.8)",
  },
  // For keys on a dark surface (black piano keys)
  onDark: {
    border: "rgba(255, 255, 255, 0.2)",
    text: "rgba(255, 255, 255, 0.35)",
    borderActive: "rgba(255, 255, 255, 0.7)",
    textActive: "rgba(255, 255, 255, 0.9)",
  },
} as const;

// ── Canvas drawing helper ───────────────────────
export function drawHotkeyBadge(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number,
  variant: "light" | "dark" | "onDark",
  active: boolean = false,
) {
  const palette = variant === "onDark" ? BADGE.onDark : BADGE[variant];
  const borderColor = active && "borderActive" in palette ? palette.borderActive : palette.border;
  const textColor = active && "textActive" in palette ? palette.textActive : palette.text;

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - maxW / 2, cy - maxH / 2, maxW, maxH, BADGE.borderRadius);
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = `${BADGE.fontWeight} ${Math.round(maxH * 0.6)}px ${BADGE.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
  ctx.textBaseline = "alphabetic";
}

// ── React component ─────────────────────────────
interface HotkeyBadgeProps {
  label: string;
  active?: boolean;
}

export default function HotkeyBadge({ label, active = false }: HotkeyBadgeProps) {
  return (
    <span className={`hotkey-badge ${active ? "active" : ""}`}>
      {label}
    </span>
  );
}
