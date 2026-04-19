import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type CameraStatus = "off" | "requesting" | "loading" | "active" | "denied" | "unsupported";

export type CameraCallbacks = {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  onStatusChange: (status: CameraStatus) => void;
  onVideoReady: (video: HTMLVideoElement) => void;
  onLandmarks: (landmarks: NormalizedLandmark[][] | null) => void;
  onHoveredNotes: (notes: Set<number>) => void;
  onKnobRotation: (angleDelta: number, engaged: boolean) => void;
};

// Keyboard range: C2 (36) to C6 (84) — 4 octaves
const MIDI_LOW = 36;
const MIDI_HIGH = 84;

// Curl-to-play: MIDI velocity mapped from curl speed
const CURL_VEL_FLOOR = 0.01;
const CURL_VEL_CEIL = 0.06;
const MIDI_VEL_MIN = 40;
const MIDI_VEL_MAX = 120;

// Only trigger/hover in the lower portion of the frame (near keyboard)
const MIN_TRIGGER_Y = 0.70;

// Smoothing factor for position EMA
const SMOOTH_ALPHA = 0.35;

// Fingertip landmark indices and their PIP offsets
const FINGERTIPS = [4, 8, 12, 16, 20];

// Min interval between detection frames (~15 FPS)
const FRAME_INTERVAL = 66;

// Knob: normalized position on screen (right-center area)
const KNOB_X = 0.18;
const KNOB_Y = 0.45;
const KNOB_ENGAGE_RADIUS = 0.10;
const KNOB_CLUSTER_THRESHOLD = 0.08;

type FingerState = {
  xSmoothed: number;
  ySmoothed: number;
  prevCurlDist: number;
  pressed: boolean;
  midi: number;
};

let video: HTMLVideoElement | null = null;
let handLandmarker: HandLandmarker | null = null;
let stream: MediaStream | null = null;
let animFrame = 0;
let lastFrameTime = 0;
let callbacks: CameraCallbacks | null = null;
let active = false;
let paused = false;

const fingerStates = new Map<string, FingerState>();
const activeFingerNotes = new Map<string, number>();
let prevHoveredNotes = new Set<number>();

// Knob state
let knobEngaged = false;
let knobPrevAngle: number | null = null;

function xToMidi(x: number): number {
  const mirrored = 1.0 - x;
  const midi = Math.round(MIDI_LOW + mirrored * (MIDI_HIGH - MIDI_LOW));
  return Math.max(MIDI_LOW, Math.min(MIDI_HIGH, midi));
}

function curlSpeedToMidi(curlSpeed: number): number {
  const t = Math.min(Math.max((curlSpeed - CURL_VEL_FLOOR) / (CURL_VEL_CEIL - CURL_VEL_FLOOR), 0), 1);
  return Math.round(MIDI_VEL_MIN + t * (MIDI_VEL_MAX - MIDI_VEL_MIN));
}

function processHands(landmarks: NormalizedLandmark[][]) {
  if (!callbacks) return;

  const seenFingers = new Set<string>();
  const hoveredNotes = new Set<number>();

  for (let h = 0; h < landmarks.length; h++) {
    const hand = landmarks[h];

    // Check if this hand is engaging the knob (skip finger-by-finger processing if so)
    if (processKnob(hand)) continue;

    for (const tip of FINGERTIPS) {
      const lm = hand[tip];
      const id = `h${h}-t${tip}`;
      seenFingers.add(id);

      const pip = hand[tip - 2];
      const curlDist = lm.y - pip.y;
      const curled = curlDist > 0;

      let state = fingerStates.get(id);
      if (!state) {
        state = { xSmoothed: lm.x, ySmoothed: lm.y, prevCurlDist: curlDist, pressed: false, midi: 0 };
        fingerStates.set(id, state);
      }

      state.xSmoothed = SMOOTH_ALPHA * lm.x + (1 - SMOOTH_ALPHA) * state.xSmoothed;
      state.ySmoothed = SMOOTH_ALPHA * lm.y + (1 - SMOOTH_ALPHA) * state.ySmoothed;

      const midi = xToMidi(state.xSmoothed);
      const inZone = state.ySmoothed > MIN_TRIGGER_Y;
      const curlSpeed = curlDist - state.prevCurlDist;

      if (curled && !state.pressed && inZone) {
        state.pressed = true;
        state.midi = midi;
        activeFingerNotes.set(id, midi);
        callbacks.onNoteOn(midi, curlSpeedToMidi(Math.abs(curlSpeed)));
      } else if (!curled && state.pressed) {
        state.pressed = false;
        const prev = activeFingerNotes.get(id);
        if (prev !== undefined) {
          callbacks.onNoteOff(prev);
          activeFingerNotes.delete(id);
        }
      }

      if (!curled && inZone && !state.pressed) {
        hoveredNotes.add(midi);
      }

      state.prevCurlDist = curlDist;
    }
  }

  // Clean up fingers that disappeared
  for (const id of fingerStates.keys()) {
    if (!seenFingers.has(id) && !fingerStates.get(id)!.pressed) {
      fingerStates.delete(id);
    }
  }

  // Emit hover changes
  if (!setsEqual(hoveredNotes, prevHoveredNotes)) {
    prevHoveredNotes = hoveredNotes;
    callbacks.onHoveredNotes(hoveredNotes);
  }
}

function processKnob(hand: NormalizedLandmark[]): boolean {
  if (!callbacks) return false;

  const tips = FINGERTIPS.map(i => hand[i]);
  const cx = tips.reduce((s, t) => s + t.x, 0) / tips.length;
  const cy = tips.reduce((s, t) => s + t.y, 0) / tips.length;

  // Mirror X to match screen coordinates
  const mirroredCx = 1.0 - cx;

  // Check if centroid is near the knob
  const dx = mirroredCx - KNOB_X;
  const dy = cy - KNOB_Y;
  const distToKnob = Math.sqrt(dx * dx + dy * dy);

  if (distToKnob > KNOB_ENGAGE_RADIUS) {
    if (knobEngaged) {
      knobEngaged = false;
      knobPrevAngle = null;
      callbacks.onKnobRotation(0, false);
    }
    return false;
  }

  // Check if tips are clustered tightly
  const spread = Math.max(
    ...tips.map(t => Math.sqrt((t.x - cx) ** 2 + (t.y - cy) ** 2))
  );
  if (spread > KNOB_CLUSTER_THRESHOLD) {
    if (knobEngaged) {
      knobEngaged = false;
      knobPrevAngle = null;
      callbacks.onKnobRotation(0, false);
    }
    return false;
  }

  // Compute average angle of index fingertip relative to centroid
  const indexTip = hand[8];
  const angle = Math.atan2(indexTip.y - cy, indexTip.x - cx);

  if (!knobEngaged) {
    knobEngaged = true;
    knobPrevAngle = angle;
    callbacks.onKnobRotation(0, true);
    return true;
  }

  if (knobPrevAngle !== null) {
    let delta = angle - knobPrevAngle;
    // Normalize to [-PI, PI]
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) > 0.005) {
      callbacks.onKnobRotation(delta, true);
    }
  }
  knobPrevAngle = angle;
  return true;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function releaseAllNotes() {
  if (callbacks) {
    for (const [, midi] of activeFingerNotes) {
      callbacks.onNoteOff(midi);
    }
  }
  activeFingerNotes.clear();
  fingerStates.clear();
  prevHoveredNotes = new Set();
  knobEngaged = false;
  knobPrevAngle = null;
}

function detect() {
  if (!active || !handLandmarker || !video || !callbacks) return;

  const now = performance.now();
  if (now - lastFrameTime >= FRAME_INTERVAL) {
    lastFrameTime = now;
    const result = handLandmarker.detectForVideo(video, now);
    callbacks.onLandmarks(result.landmarks.length > 0 ? result.landmarks : null);
    if (!paused) {
      processHands(result.landmarks);
    }
  }

  animFrame = requestAnimationFrame(detect);
}

export async function startCamera(cbs: CameraCallbacks): Promise<void> {
  callbacks = cbs;

  if (!navigator.mediaDevices?.getUserMedia) {
    cbs.onStatusChange("unsupported");
    return;
  }

  cbs.onStatusChange("requesting");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch {
    cbs.onStatusChange("denied");
    return;
  }

  video = document.createElement("video");
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  await video.play();

  cbs.onVideoReady(video);
  cbs.onStatusChange("loading");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });

  active = true;
  cbs.onStatusChange("active");
  lastFrameTime = 0;
  animFrame = requestAnimationFrame(detect);
}

export function stopCamera(): void {
  active = false;
  paused = false;
  cancelAnimationFrame(animFrame);

  releaseAllNotes();

  handLandmarker?.close();
  handLandmarker = null;

  if (video) {
    video.pause();
    video.srcObject = null;
  }
  video = null;

  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;

  callbacks?.onStatusChange("off");
  callbacks?.onLandmarks(null);
  callbacks?.onHoveredNotes(new Set());
  callbacks?.onKnobRotation(0, false);
  callbacks = null;
}

export function isCameraActive(): boolean {
  return active;
}

export function pauseCamera(): void {
  paused = true;
  releaseAllNotes();
}

export function resumeCamera(): void {
  paused = false;
}

export { KNOB_X, KNOB_Y, KNOB_ENGAGE_RADIUS };
