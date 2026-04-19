# Camera Mode Handoff — 2026-04-19

## What we're working on

The **camera input mode** for Tonal (chorddetector.vercel.app). Users play piano by moving their hands in front of a webcam. The system tracks hand landmarks via MediaPipe and maps finger positions to piano keys.

## Current state

### Curl-to-play (v2 — shipped)

The triggering model is now **curl-based**: extend fingers to hover over keys, curl a finger (tip drops below PIP joint) to play, uncurl to release. This replaced the velocity-based jab model which was too noisy.

- **Hover highlights**: extended fingers in the trigger zone (Y ≥ 0.70) highlight keys with semi-transparent gold tint
- **Curl detection**: `lm.y > pip.y` = curled = note on. Relative measurement between two joints, immune to hand drift.
- **Curl speed → MIDI velocity**: fast curl = loud, gentle curl = soft
- **Release**: uncurl (extend finger again) = note off

### Virtual filter knob (shipped)

A circular knob renders in the upper-left of the camera overlay. Cluster all 5 fingertips near the knob center, then rotate your hand to sweep a lowpass filter (200 Hz → 18 kHz).

- Knob detection: checks if 5 fingertip centroid is near knob position and tips are tightly clustered
- Tracks rotation via index fingertip angle relative to centroid
- Maps to Tone.js lowpass filter with -24dB rolloff, Q=2

## Key files

- `web/src/lib/cameraEngine.ts` — all detection logic. Constants: `CURL_VEL_FLOOR/CEIL`, `MIN_TRIGGER_Y`, `KNOB_X/Y/ENGAGE_RADIUS/CLUSTER_THRESHOLD`. Exports knob position constants.
- `web/src/components/CameraOverlay.tsx` — skeleton rendering + knob visual. Knob has idle/engaged states, indicator line, arc track.
- `web/src/components/Keyboard.tsx` — accepts `hoveredNotes` prop for camera hover highlights.
- `web/src/lib/audioEngine.ts` — `djFilter` in signal chain, `setDjFilterCutoff(normalized)` API.
- `web/src/App.tsx` — wires camera state, hovered notes, knob rotation → filter cutoff.

## What was tried and reverted

1. **Velocity-based triggering** — downward jab fires note. Too noisy, triggered by hand drift. Replaced with curl detection.
2. **2-octave keyboard at top** — moved keyboard to top of screen via CSS `order`, cut to C3–C5. Reverted: user preferred 4 octaves at bottom.
3. **Y-threshold zone entry/exit** — trigger on entering a Y zone, release on leaving. Reverted: user wanted deliberate gesture.

## Iteration approach

The user deploys to Vercel after each change and tests on the live site. Workflow: edit → `npx tsc --noEmit` → `npx vercel --prod` (from `web/` dir). Use `/ship` skill at end of session to commit + update README.

## Next steps

1. Test and tune curl thresholds on the live site
2. Per-finger curl sensitivity (thumb behaves differently from index)
3. Visual feedback: fingertip color change when curled/playing vs hovering
4. Knob UX: test if the cluster detection radius feels right, tune sensitivity
5. Consider additional knob targets (reverb, volume, pitch bend)
