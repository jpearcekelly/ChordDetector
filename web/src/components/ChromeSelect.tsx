// Reusable chrome bar dropdown cell.
// Renders as a <label> wrapping a <select> — clicking anywhere in the cell opens the dropdown.
// Optional status dot and inactive styling.

import type { ReactNode } from "react";

type StatusDotVariant = "connected" | "pending" | "denied" | null;

interface ChromeSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode; // <option> / <optgroup> elements
  inactive?: boolean;  // grey text when in "no selection" state
  statusDot?: StatusDotVariant;
  className?: string;
}

export default function ChromeSelect({
  id,
  value,
  onChange,
  children,
  inactive = false,
  statusDot = null,
  className = "",
}: ChromeSelectProps) {
  return (
    <label className={`chrome-cell chrome-select-cell ${className}`} htmlFor={id}>
      {statusDot && <span className={`status-dot ${statusDot}`} />}
      <select
        id={id}
        className={`chrome-select-input ${inactive ? "inactive" : ""}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.blur();
        }}
      >
        {children}
      </select>
    </label>
  );
}
