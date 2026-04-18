type Props = {
  darkMode: boolean;
  onToggle: (e: React.MouseEvent) => void;
};

export default function ThemeSwitch({ darkMode, onToggle }: Props) {
  return (
    <button className="theme-switch" onClick={onToggle} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
      <svg className="theme-switch-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="3.5" />
        <line x1="8" y1="1" x2="8" y2="3" />
        <line x1="8" y1="13" x2="8" y2="15" />
        <line x1="1" y1="8" x2="3" y2="8" />
        <line x1="13" y1="8" x2="15" y2="8" />
        <line x1="3.05" y1="3.05" x2="4.46" y2="4.46" />
        <line x1="11.54" y1="11.54" x2="12.95" y2="12.95" />
        <line x1="3.05" y1="12.95" x2="4.46" y2="11.54" />
        <line x1="11.54" y1="4.46" x2="12.95" y2="3.05" />
      </svg>

      <span className="theme-switch-track">
        <span className={`theme-switch-thumb ${darkMode ? "on" : ""}`} />
      </span>

      <svg className="theme-switch-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 8.5A6.5 6.5 0 0 1 7.5 2 6.5 6.5 0 1 0 14 8.5Z" />
      </svg>
    </button>
  );
}
