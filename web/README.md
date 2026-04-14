# Tonal

Real-time chord detection and music theory tool for musicians. Play chords via MIDI keyboard, computer keyboard, or microphone — see chord names, inversions, roman numeral analysis, and scale relationships instantly.

**Live:** [chorddetector.vercel.app](https://chorddetector.vercel.app)

## Stack

React + TypeScript + Vite, Web MIDI API, Web Audio API (mic), Tone.js (Salamander piano samples)

## Development

```bash
cd web
npm install
npm run dev
```

Deploy: `npx vercel --prod`

## Roadmap

### UX / Onboarding
- [ ] Splash/holding screen on load — input selection + forces first click for AudioContext
- [ ] Key lock onboarding — tooltip or splash screen explanation (biggest UX friction point for new users)

### Features
- [ ] Scale auto-demo — plays selected scale up and down 4 octaves, showcasing keyboard visuals
- [x] Alternative sounds — sawtooth synth, Rhodes electric piano (sound selector)
- [ ] Camera input — play virtual keyboard via webcam hand tracking

### Product / Growth
- [ ] Custom domain + proper hosting
- [ ] Feedback form — gather user insights
- [ ] User interview booking — tied to feedback form
- [ ] Analytics — understand engagement patterns
- [ ] SEO — indexing, search promotion, AI discoverability

### Done
- [x] Dark mode persistence (localStorage)
- [x] Settings panel slide-in/out animation
- [x] Keyboard always renders in light mode (dark mode only affects app chrome)
- [x] Hotkey badge visibility fix in dark mode
- [x] Chord replay — click chord name or press Enter to replay held chord
- [x] Play cursor on chord name hover
