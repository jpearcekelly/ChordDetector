# Tonal

Real-time chord detection and music theory tool for musicians. Play chords via MIDI keyboard, computer keyboard, or microphone — see chord names, inversions, roman numeral analysis, and scale relationships instantly.

**Live:** [chorddetector.vercel.app](https://chorddetector.vercel.app)

## Stack

React + TypeScript + Vite, Web MIDI API, Web Audio API (mic), Tone.js (Salamander piano samples), MediaPipe Hands (camera tracking)

## Development

```bash
cd web
npm install
npm run dev
```

Deploy: `npx vercel --prod`

## Roadmap

### UX / Onboarding
- [x] Splash/holding screen on load — input selection + forces first click for AudioContext
- [x] Note lock onboarding — coachmark tooltips for enable/disable, auto-enable for mouse users, renamed from "Key lock"

### Features
- [x] Scale auto-demo — plays selected scale up and down 4 octaves, showcasing keyboard visuals
- [x] Alternative sounds — sawtooth synth, Rhodes electric piano (sound selector)
- [x] Camera input — webcam hand tracking with MediaPipe, curl-to-play triggering, hover highlights
- [x] Camera DJ knob — virtual filter knob controlled by hand rotation, lowpass sweep

### Product / Growth
- [ ] Custom domain + proper hosting
- [ ] Feedback form — gather user insights
- [ ] User interview booking — tied to feedback form
- [ ] Analytics — understand engagement patterns
- [ ] SEO — indexing, search promotion, AI discoverability

### Done
- [x] Dark mode persistence (localStorage)
- [x] Dark mode radial ink transition (View Transitions API)
- [x] Splash screen — input cards, dark mode switch, pinned layout
- [x] Settings panel slide-in/out animation
- [x] Keyboard always renders in light mode (dark mode only affects app chrome)
- [x] Hotkey badge visibility fix in dark mode
- [x] Chord replay — click chord name or press Enter to replay held chord
- [x] Play cursor on chord name hover
