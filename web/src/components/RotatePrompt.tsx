export default function RotatePrompt() {
  return (
    <div className="rotate-prompt">
      <div className="rotate-content">
        <h1 className="rotate-logo">Tonal</h1>
        <svg
          className="rotate-icon"
          width="64"
          height="64"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="16" y="8" width="32" height="48" rx="4" />
          <line x1="28" y1="48" x2="36" y2="48" />
        </svg>
        <p className="rotate-text">Rotate your phone for the best experience</p>
        <button className="rotate-dismiss" onClick={(e) => {
          (e.currentTarget.closest(".rotate-prompt") as HTMLElement)?.classList.add("dismissed");
        }}>
          Continue in portrait
        </button>
      </div>
    </div>
  );
}
