import * as Tone from "tone";

export type SoundType = "piano" | "rhodes" | "sawtooth";

let currentSound: SoundType = "piano";

// Sources — only one active at a time
let sampler: Tone.Sampler | null = null;
let synth: Tone.PolySynth | null = null;

// Shared signal chain
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
const pendingNotes = new Set<number>();
const activeVelocities = new Map<number, number>();
let onLoadCallback: (() => void) | null = null;

export function onSamplerLoaded(cb: () => void) {
  if (samplerLoaded) { cb(); return; }
  onLoadCallback = cb;
}

export function isSamplerLoaded() {
  return samplerLoaded;
}

export function getCurrentSound(): SoundType {
  return currentSound;
}

function midiToNote(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteToPan(midi: number): number {
  return Math.max(-0.8, Math.min(0.8, ((midi - 60) / 44) * 0.8));
}

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

// ── Shared effects chain (built once) ──────────────────

function ensureEffectsChain() {
  if (compressor) return; // already built

  brightnessFilter = new Tone.Filter({
    type: "lowpass",
    frequency: 12000,
    rolloff: -12,
    Q: 0.5,
  });

  velocityGain = new Tone.Gain(1);
  panner = new Tone.Panner(0);

  compressor = new Tone.Compressor({
    threshold: -18,
    ratio: 3,
    attack: 0.01,
    release: 0.2,
    knee: 10,
  });

  reverb = new Tone.Reverb({ decay: 2.5, wet: 1 });
  reverbGain = new Tone.Gain(0.08);
  dryGain = new Tone.Gain(1);
  limiter = new Tone.Limiter(-2);

  compressor.connect(dryGain);
  compressor.connect(reverb);
  reverb.connect(reverbGain);
  dryGain.connect(limiter);
  reverbGain.connect(limiter);
  limiter.toDestination();
}

// Connect a source into the shared chain
function connectSource(source: Tone.ToneAudioNode) {
  ensureEffectsChain();
  source.chain(velocityGain!, brightnessFilter!, panner!, compressor!);
}

// ── Piano (Salamander sampler) ─────────────────────────

let pianoLoadPromise: Promise<void> | null = null;

function ensurePiano() {
  if (sampler) return;
  pianoLoadPromise = new Promise<void>((resolve) => {
    sampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
        A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
        A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
        A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
        A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
        A5: "A5.mp3", C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
        A6: "A6.mp3", C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
        A7: "A7.mp3", C8: "C8.mp3",
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
  connectSource(sampler!);
}

// ── Rhodes (FM synthesis) ──────────────────────────────

function createRhodesSynth(): Tone.PolySynth {
  const poly = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 1.5,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 1.2, sustain: 0.3, release: 1.5 },
    modulation: { type: "square" },
    modulationEnvelope: { attack: 0.002, decay: 0.8, sustain: 0.1, release: 0.5 },
    volume: -10,
  });
  poly.maxPolyphony = 16;
  return poly;
}

// ── Sawtooth synth ─────────────────────────────────────

function createSawSynth(): Tone.PolySynth {
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4 },
    volume: -14,
  });
  poly.maxPolyphony = 16;
  return poly;
}

// ── Sound switching ────────────────────────────────────

export function setSound(sound: SoundType) {
  if (sound === currentSound) return;

  // Stop all current notes
  allNotesOff();

  // Disconnect old synth from chain
  if (synth) {
    synth.disconnect();
    synth.dispose();
    synth = null;
  }

  currentSound = sound;

  if (sound === "piano") {
    ensurePiano();
  } else {
    // Create and connect the appropriate synth
    synth = sound === "rhodes" ? createRhodesSynth() : createSawSynth();
    connectSource(synth);
  }
}

// ── Public API (unchanged interface) ───────────────────

export function getAudioEngine() {
  ensurePiano(); // always load piano (default sound)
  return sampler;
}

export async function noteOn(midi: number, velocity: number) {
  pendingNotes.add(midi);
  await ensureStarted();

  if (currentSound === "piano") {
    getAudioEngine();
    if (!samplerLoaded && pianoLoadPromise) {
      await pianoLoadPromise;
    }
  } else if (!synth) {
    // Synth should exist but guard just in case
    setSound(currentSound);
  }

  if (!pendingNotes.has(midi)) return;

  activeVelocities.set(midi, velocity);
  const peakVel = Math.max(...activeVelocities.values()) / 127;

  if (velocityGain) velocityGain.gain.value = 0.1 + 1.5 * peakVel;
  if (brightnessFilter) brightnessFilter.frequency.value = 5000 + 13000 * peakVel;

  if (panner) {
    let panSum = 0;
    let weightSum = 0;
    for (const [note, vel] of activeVelocities) {
      panSum += noteToPan(note) * vel;
      weightSum += vel;
    }
    panner.pan.value = weightSum > 0 ? panSum / weightSum : 0;
  }

  if (reverbGain) reverbGain.gain.value = 0.02 + 0.12 * peakVel;

  if (currentSound === "piano") {
    sampler!.triggerAttack(midiToNote(midi));
  } else {
    synth!.triggerAttack(midiToFreq(midi));
  }
}

export function noteOff(midi: number) {
  pendingNotes.delete(midi);
  activeVelocities.delete(midi);

  if (currentSound === "piano") {
    sampler?.triggerRelease(midiToNote(midi));
  } else {
    synth?.triggerRelease(midiToFreq(midi));
  }

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
  synth?.releaseAll();
}
