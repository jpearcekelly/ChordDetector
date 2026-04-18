import type { MIDIStatus } from "../lib/midiEngine";
import ThemeSwitch from "./ThemeSwitch";

export type InputChoice = "midi" | "mic" | "keyboard" | "camera";

type Props = {
  midiStatus: MIDIStatus;
  isMobile: boolean;
  darkMode: boolean;
  onToggleDarkMode: (e: React.MouseEvent) => void;
  onSelect: (choice: InputChoice) => void;
  className?: string;
};

export default function SplashScreen({ midiStatus, isMobile, darkMode, onToggleDarkMode, onSelect, className = "" }: Props) {
  const midiUnsupported = !navigator.requestMIDIAccess;
  const midiConnected = midiStatus.state === "connected" && midiStatus.deviceCount > 0;

  return (
    <div className={`splash-overlay ${className}`}>
      <h1 className="splash-title">Tonal</h1>

      <div className="splash-content">
        <p className="splash-subtitle">Choose your input method</p>

        <div className="splash-cards">
          <button
            className={`splash-card ${midiUnsupported ? "disabled" : ""} ${midiConnected ? "highlighted" : ""}`}
            onClick={() => !midiUnsupported && onSelect("midi")}
            disabled={midiUnsupported}
          >
            <svg className="splash-card-icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="28" height="20" rx="3" />
              <line x1="9" y1="18" x2="9" y2="26" />
              <line x1="16" y1="18" x2="16" y2="26" />
              <line x1="23" y1="18" x2="23" y2="26" />
              <rect x="7" y="6" width="4" height="12" rx="0.5" />
              <rect x="14" y="6" width="4" height="12" rx="0.5" />
              <rect x="21" y="6" width="4" height="12" rx="0.5" />
            </svg>
            <span className="splash-card-label">MIDI</span>
            <span className={`splash-card-note ${midiConnected ? "splash-card-connected" : ""}`}>
              {midiUnsupported ? "Not supported in this browser"
                : midiConnected ? "Device connected"
                : "Electric keyboards"}
            </span>
          </button>

          <button className="splash-card" onClick={() => onSelect("mic")}>
            <svg className="splash-card-icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="12" y="4" width="8" height="16" rx="4" />
              <path d="M8 16a8 8 0 0 0 16 0" />
              <line x1="16" y1="24" x2="16" y2="28" />
              <line x1="12" y1="28" x2="20" y2="28" />
            </svg>
            <span className="splash-card-label">Microphone</span>
            <span className="splash-card-note">Acoustic pianos</span>
          </button>

          <button className="splash-card" onClick={() => onSelect("keyboard")}>
            {isMobile ? (
              <svg className="splash-card-icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="4" width="16" height="24" rx="3" />
                <line x1="13" y1="26" x2="19" y2="26" />
              </svg>
            ) : (
              <svg className="splash-card-icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="24" height="14" rx="2" />
                <line x1="8" y1="14" x2="10" y2="14" />
                <line x1="12" y1="14" x2="14" y2="14" />
                <line x1="16" y1="14" x2="18" y2="14" />
                <line x1="20" y1="14" x2="24" y2="14" />
                <line x1="10" y1="18" x2="22" y2="18" />
              </svg>
            )}
            <span className="splash-card-label">
              {isMobile ? "Screen tap" : "Mouse and keyboard"}
            </span>
            <span className="splash-card-note">
              {isMobile ? "Tap keys on screen" : "Manual input"}
            </span>
          </button>

          {!isMobile && (
            <button className="splash-card" onClick={() => onSelect("camera")}>
              <svg className="splash-card-icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="24" height="18" rx="2" />
                <circle cx="16" cy="17" r="5" />
                <circle cx="16" cy="17" r="2" />
                <rect x="11" y="5" width="10" height="3" rx="1" />
              </svg>
              <span className="splash-card-label">Hand tracking</span>
              <span className="splash-card-note">Play with your webcam</span>
            </button>
          )}
        </div>

      </div>

      <div className="splash-switch-container">
        <ThemeSwitch darkMode={darkMode} onToggle={onToggleDarkMode} />
      </div>
    </div>
  );
}
