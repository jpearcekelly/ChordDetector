import * as Tone from "tone";

let sampler: Tone.Sampler | null = null;
let compressor: Tone.Compressor | null = null;
let limiter: Tone.Limiter | null = null;
let velocityGain: Tone.Gain | null = null;
let brightnessFilter: Tone.Filter | null = null;
let panner: Tone.Panner | null = null;
let reverb: Tone.Reverb | null = null;
let reverbGain: Tone.Gain | null = null;
let dryGain: Tone.Gain | null = null;
let started = false;
let samplerLoaded = false;
const pendingNotes = new Set<number>(); // notes waiting for audio context
const activeVelocities = new Map<number, number>(); // midi → velocity for all sounding notes
let onLoadCallback: (() => void) | null = null;

export function onSamplerLoaded(cb: () => void) {
  if (samplerLoaded) { cb(); return; }
  onLoadCallback = cb;
}

export function isSamplerLoaded() {
  return samplerLoaded;
}

function midiToNote(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

// Map MIDI note to stereo position (-1 left to +1 right)
// A0 (21) = -0.8, C4 (60) = ~0, C8 (108) = +0.8
function noteToPan(midi: number): number {
  return Math.max(-0.8, Math.min(0.8, ((midi - 60) / 44) * 0.8));
}

// Call this synchronously from user gesture handlers (keydown, click, pointerdown)
// to ensure AudioContext is resumed before any async work
export function ensureAudioContext() {
  if (!started) {
    Tone.start().then(() => { started = true; });
  }
}

async function ensureStarted() {
  if (!started) {
    await Tone.start();
    started = true;
  }
}

let loadPromise: Promise<void> | null = null;

export function getAudioEngine() {
  if (!sampler) {
    loadPromise = new Promise<void>((resolve) => {
      sampler = new Tone.Sampler({
        urls: {
          A0: "A0.mp3",
          C1: "C1.mp3",
          "D#1": "Ds1.mp3",
          "F#1": "Fs1.mp3",
          A1: "A1.mp3",
          C2: "C2.mp3",
          "D#2": "Ds2.mp3",
          "F#2": "Fs2.mp3",
          A2: "A2.mp3",
          C3: "C3.mp3",
          "D#3": "Ds3.mp3",
          "F#3": "Fs3.mp3",
          A3: "A3.mp3",
          C4: "C4.mp3",
          "D#4": "Ds4.mp3",
          "F#4": "Fs4.mp3",
          A4: "A4.mp3",
          C5: "C5.mp3",
          "D#5": "Ds5.mp3",
          "F#5": "Fs5.mp3",
          A5: "A5.mp3",
          C6: "C6.mp3",
          "D#6": "Ds6.mp3",
          "F#6": "Fs6.mp3",
          A6: "A6.mp3",
          C7: "C7.mp3",
          "D#7": "Ds7.mp3",
          "F#7": "Fs7.mp3",
          A7: "A7.mp3",
          C8: "C8.mp3",
        },
        release: 1,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
        volume: -6,
        onload: () => {
          samplerLoaded = true;
          onLoadCallback?.();
          onLoadCallback = null;
          resolve();
        },
      });
    });

    // Velocity-sensitive brightness: subtle high-shelf cut on soft notes
    // Soft = 5kHz, Hard = 18kHz (nearly transparent)
    brightnessFilter = new Tone.Filter({
      type: "lowpass",
      frequency: 12000,
      rolloff: -12,
      Q: 0.5,
    });

    // Velocity gain
    velocityGain = new Tone.Gain(1);

    // Stereo positioning based on note register
    panner = new Tone.Panner(0);

    // Compressor: gentle enough to preserve dynamics, firm enough to tame big chords
    compressor = new Tone.Compressor({
      threshold: -18,
      ratio: 3,
      attack: 0.01,
      release: 0.2,
      knee: 10,
    });

    // Subtle reverb for sympathetic resonance — more reverb on harder strikes
    reverb = new Tone.Reverb({ decay: 2.5, wet: 1 });
    reverbGain = new Tone.Gain(0.08); // blended in subtly
    dryGain = new Tone.Gain(1);

    // Hard limiter — nothing above -2 dB reaches the speakers
    limiter = new Tone.Limiter(-2);

    // Signal chain:
    // Sampler → VelocityGain → BrightnessFilter → Panner → Compressor
    //   ├→ DryGain ──────────────→ Limiter → Output
    //   └→ Reverb → ReverbGain ──→ Limiter → Output
    sampler!.chain(velocityGain, brightnessFilter, panner, compressor);
    compressor.connect(dryGain);
    compressor.connect(reverb);
    reverb.connect(reverbGain);
    dryGain.connect(limiter);
    reverbGain.connect(limiter);
    limiter.toDestination();
  }
  return sampler;
}

export async function noteOn(midi: number, velocity: number) {
  pendingNotes.add(midi);
  await ensureStarted();
  const engine = getAudioEngine();
  // Wait for samples to finish loading
  if (!samplerLoaded && loadPromise) {
    await loadPromise;
  }
  // If note was released while we were waiting, don't trigger
  if (!pendingNotes.has(midi)) return;

  // Track this note's velocity
  activeVelocities.set(midi, velocity);

  // Use the peak velocity of all sounding notes for global settings
  // This prevents a soft note from dimming a loud sustained chord
  const peakVel = Math.max(...activeVelocities.values()) / 127;

  // 1. Volume: use peak so loud notes aren't squashed by subsequent soft ones
  if (velocityGain) {
    velocityGain.gain.value = 0.1 + 1.5 * peakVel;
  }

  // 2. Brightness: use peak — open the filter for the loudest note
  if (brightnessFilter) {
    brightnessFilter.frequency.value = 5000 + 13000 * peakVel;
  }

  // 3. Stereo position: weighted average of all sounding notes
  if (panner) {
    let panSum = 0;
    let weightSum = 0;
    for (const [note, vel] of activeVelocities) {
      panSum += noteToPan(note) * vel;
      weightSum += vel;
    }
    panner.pan.value = weightSum > 0 ? panSum / weightSum : 0;
  }

  // 4. Reverb send: based on peak velocity
  if (reverbGain) {
    reverbGain.gain.value = 0.02 + 0.12 * peakVel;
  }

  engine!.triggerAttack(midiToNote(midi));
}

export function noteOff(midi: number) {
  pendingNotes.delete(midi);
  activeVelocities.delete(midi);
  sampler?.triggerRelease(midiToNote(midi));

  // Recalculate globals for remaining notes
  if (activeVelocities.size > 0) {
    const peakVel = Math.max(...activeVelocities.values()) / 127;
    if (velocityGain) velocityGain.gain.value = 0.1 + 1.5 * peakVel;
    if (brightnessFilter) brightnessFilter.frequency.value = 5000 + 13000 * peakVel;
    if (reverbGain) reverbGain.gain.value = 0.02 + 0.12 * peakVel;
  }
}

export function allNotesOff() {
  pendingNotes.clear();
  activeVelocities.clear();
  sampler?.releaseAll();
}
