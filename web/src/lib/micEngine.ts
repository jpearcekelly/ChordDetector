/**
 * Microphone-based pitch detection for acoustic piano.
 *
 * Approach: detect volume spikes (note attacks), capture the notes during
 * the spike, then hold them until the next attack or silence.
 */

export type MicStatus = "off" | "requesting" | "active" | "denied" | "unsupported";

export type MicCallbacks = {
  onNotesChanged: (activeNotes: Set<number>) => void;
  onStatusChange: (status: MicStatus) => void;
};

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let stream: MediaStream | null = null;
let animFrame = 0;
let callbacks: MicCallbacks | null = null;
let active = false;

// State
let noiseFloor = -80;
let currentNotes = new Set<number>();
let recentEnergy = -100;  // rolling energy level
let silenceFrames = 0;    // frames since last significant sound
let attackCooldown = 0;   // cooldown after an attack to avoid re-triggering

const ATTACK_THRESHOLD = 8;   // dB jump above recent energy to detect an attack
const SILENCE_FRAMES = 90;    // ~1.5s of silence before clearing notes
const ATTACK_COOLDOWN = 15;   // ~250ms cooldown between attacks
const CAPTURE_FRAMES = 5;     // frames to collect notes after attack detected
const MIN_ABSOLUTE = -75;     // minimum dB for a peak to be a note

let captureMode = false;
let captureCount = 0;
let capturedNotes = new Map<number, number>(); // midi → times seen during capture

function freqToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

/** Get the overall energy in the piano frequency range */
function getEnergy(freqData: Float32Array, sampleRate: number, fftSize: number): number {
  const binHz = sampleRate / fftSize;
  const minBin = Math.ceil(27.5 / binHz);
  const maxBin = Math.min(Math.floor(4200 / binHz), freqData.length - 1);
  let sum = 0;
  let count = 0;
  for (let i = minBin; i <= maxBin; i++) {
    if (freqData[i] > -120) {
      sum += freqData[i];
      count++;
    }
  }
  return count > 0 ? sum / count : -120;
}

/** Find the strongest peaks in the FFT — returns MIDI note numbers */
function detectPeaks(freqData: Float32Array, sampleRate: number, fftSize: number): number[] {
  const binHz = sampleRate / fftSize;
  const minBin = Math.ceil(27.5 / binHz);
  const maxBin = Math.min(Math.floor(4200 / binHz), freqData.length - 2);
  const threshold = Math.max(noiseFloor + 10, MIN_ABSOLUTE);

  const peaks: { freq: number; mag: number }[] = [];
  for (let i = minBin + 1; i < maxBin; i++) {
    const mag = freqData[i];
    if (mag > threshold && mag > freqData[i - 1] && mag > freqData[i + 1]) {
      const alpha = freqData[i - 1];
      const beta = freqData[i];
      const gamma = freqData[i + 1];
      const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
      const freq = (i + p) * binHz;
      peaks.push({ freq, mag });
    }
  }

  peaks.sort((a, b) => b.mag - a.mag);

  // Collect notes, skip harmonics (3rd+) of louder notes
  const result: number[] = [];
  const accepted: { freq: number; mag: number }[] = [];

  for (const peak of peaks) {
    if (result.length >= 8) break;
    const midi = freqToMidi(peak.freq);
    if (midi < 21 || midi > 108) continue;
    if (result.includes(midi)) continue;

    // Only suppress 3rd+ harmonics that are much weaker
    let isHarmonic = false;
    for (const f of accepted) {
      for (let h = 3; h <= 4; h++) {
        const ratio = peak.freq / (f.freq * h);
        if (ratio > 0.98 && ratio < 1.02 && peak.mag < f.mag - 8) {
          isHarmonic = true;
          break;
        }
      }
      if (isHarmonic) break;
    }

    if (!isHarmonic) {
      result.push(midi);
      accepted.push(peak);
    }
  }

  return result;
}

function calibrateNoiseFloor(freqData: Float32Array) {
  const values: number[] = [];
  for (let i = 0; i < freqData.length; i++) {
    if (freqData[i] > -120) values.push(freqData[i]);
  }
  if (values.length === 0) return;
  values.sort((a, b) => a - b);
  noiseFloor = values[Math.floor(values.length * 0.9)];
}

function analyze() {
  if (!active || !analyser || !callbacks) return;

  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const sampleRate = audioCtx!.sampleRate;
  const fftSize = analyser.fftSize;

  const energy = getEnergy(freqData, sampleRate, fftSize);

  if (attackCooldown > 0) attackCooldown--;

  // Detect attack: sudden energy increase
  const isAttack = energy > recentEnergy + ATTACK_THRESHOLD && attackCooldown === 0;

  if (isAttack) {
    // Start capturing notes
    captureMode = true;
    captureCount = 0;
    capturedNotes.clear();
    attackCooldown = ATTACK_COOLDOWN;
    silenceFrames = 0;
  }

  if (captureMode) {
    // Collect notes over several frames
    const notes = detectPeaks(freqData, sampleRate, fftSize);
    for (const midi of notes) {
      capturedNotes.set(midi, (capturedNotes.get(midi) ?? 0) + 1);
    }
    captureCount++;

    if (captureCount >= CAPTURE_FRAMES) {
      // Capture complete — accept notes seen in at least 2 frames
      const newNotes = new Set<number>();
      for (const [midi, count] of capturedNotes) {
        if (count >= 2) newNotes.add(midi);
      }
      if (newNotes.size > 0) {
        currentNotes = newNotes;
        callbacks.onNotesChanged(new Set(currentNotes));
      }
      captureMode = false;
    }
  }

  // Track silence — clear notes after sustained silence
  if (energy < noiseFloor + 5) {
    silenceFrames++;
    if (silenceFrames >= SILENCE_FRAMES && currentNotes.size > 0) {
      currentNotes.clear();
      callbacks.onNotesChanged(new Set());
    }
  } else {
    silenceFrames = 0;
  }

  // Update rolling energy (slow follow)
  recentEnergy = recentEnergy * 0.95 + energy * 0.05;

  // Recalibrate noise floor during silence
  if (silenceFrames > 30 && currentNotes.size === 0) {
    calibrateNoiseFloor(freqData);
  }

  animFrame = requestAnimationFrame(analyze);
}

export async function startMic(cbs: MicCallbacks): Promise<void> {
  callbacks = cbs;

  if (!navigator.mediaDevices?.getUserMedia) {
    cbs.onStatusChange("unsupported");
    return;
  }

  cbs.onStatusChange("requesting");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch {
    cbs.onStatusChange("denied");
    return;
  }

  audioCtx = new AudioContext();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 16384;
  analyser.smoothingTimeConstant = 0.5;
  sourceNode.connect(analyser);

  active = true;
  cbs.onStatusChange("active");

  // Calibrate noise floor after a brief settling period
  setTimeout(() => {
    if (analyser) {
      const freqData = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(freqData);
      calibrateNoiseFloor(freqData);
    }
  }, 500);

  animFrame = requestAnimationFrame(analyze);
}

export function stopMic(): void {
  active = false;
  cancelAnimationFrame(animFrame);
  sourceNode?.disconnect();
  analyser?.disconnect();
  audioCtx?.close();
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  sourceNode = null;
  analyser = null;
  audioCtx = null;
  stream = null;
  currentNotes.clear();
  capturedNotes.clear();
  captureMode = false;
  noiseFloor = -80;
  recentEnergy = -100;
  silenceFrames = 0;
  attackCooldown = 0;

  callbacks?.onStatusChange("off");
  callbacks?.onNotesChanged(new Set());
  callbacks = null;
}

export function isMicActive(): boolean {
  return active;
}
