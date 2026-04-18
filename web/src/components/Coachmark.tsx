import { useEffect, useState } from "react";

type Props = {
  text: string;
  visible: boolean;
  duration?: number;
  onDismiss?: () => void;
  position?: "above" | "below";
};

export default function Coachmark({
  text,
  visible,
  duration = 3000,
  onDismiss,
  position = "below",
}: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!visible) { setShow(false); return; }
    setShow(true);
    const t = setTimeout(() => {
      setShow(false);
      onDismiss?.();
    }, duration);
    return () => clearTimeout(t);
  }, [visible, duration, onDismiss]);

  if (!show) return null;

  return (
    <div className={`coachmark coachmark-${position}`}>
      <div className={`coachmark-arrow coachmark-arrow-${position}`} />
      <span className="coachmark-text">{text}</span>
      <div
        className="coachmark-timer"
        style={{ animationDuration: `${duration}ms` }}
      />
    </div>
  );
}
