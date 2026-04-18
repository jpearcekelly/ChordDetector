import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type CameraStatus = "off" | "requesting" | "loading" | "active" | "denied" | "unsupported";

export type CameraCallbacks = {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  onStatusChange: (status: CameraStatus) => void;
  onVideoReady: (video: HTMLVideoElement) => void;
  onLandmarks: (landmarks: NormalizedLandmark[][] | null) => void;
};

// Visible keyboard range on desktop: C2 (36) to C6 (84)
const MIDI_LOW = 36;
const MIDI_HIGH = 84;

// Press/release Y thresholds (normalized camera coords, 0=top 1=bottom)
const PRESS_Y = 0.78;
const RELEASE_Y = 0.68;

// Smoothing factor for position EMA
const SMOOTH_ALPHA = 0.35;

// Fingertip landmark indices
const FINGERTIPS = [4, 8, 12, 16, 20];

// Min interval between detection frames (~15 FPS)
const FRAME_INTERVAL = 66;

type FingerState = {
  xSmoothed: number;
  ySmoothed: number;
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

function xToMidi(x: number): number {
  const mirrored = 1.0 - x;
  const midi = Math.round(MIDI_LOW + mirrored * (MIDI_HIGH - MIDI_LOW));
  return Math.max(MIDI_LOW, Math.min(MIDI_HIGH, midi));
}

function processHands(landmarks: NormalizedLandmark[][]) {
  if (!callbacks) return;

  const seenFingers = new Set<string>();

  for (let h = 0; h < landmarks.length; h++) {
    const hand = landmarks[h];
    for (const tip of FINGERTIPS) {
      const lm = hand[tip];
      const id = `h${h}-t${tip}`;
      seenFingers.add(id);

      const pip = hand[tip - 2];
      const extended = lm.y < pip.y;

      let state = fingerStates.get(id);
      if (!state) {
        state = { xSmoothed: lm.x, ySmoothed: lm.y, pressed: false, midi: 0 };
        fingerStates.set(id, state);
      }

      state.xSmoothed = SMOOTH_ALPHA * lm.x + (1 - SMOOTH_ALPHA) * state.xSmoothed;
      state.ySmoothed = SMOOTH_ALPHA * lm.y + (1 - SMOOTH_ALPHA) * state.ySmoothed;

      const midi = xToMidi(state.xSmoothed);

      if (!extended && state.pressed) {
        state.pressed = false;
        const prev = activeFingerNotes.get(id);
        if (prev !== undefined) {
          callbacks.onNoteOff(prev);
          activeFingerNotes.delete(id);
        }
      } else if (extended && !state.pressed && state.ySmoothed > PRESS_Y) {
        state.pressed = true;
        state.midi = midi;
        activeFingerNotes.set(id, midi);
        callbacks.onNoteOn(midi, 80);
      } else if (extended && state.pressed && state.ySmoothed < RELEASE_Y) {
        state.pressed = false;
        const prev = activeFingerNotes.get(id);
        if (prev !== undefined) {
          callbacks.onNoteOff(prev);
          activeFingerNotes.delete(id);
        }
      }
    }
  }

  // Clean up disappeared fingers — keep pressed notes held (finger exited below)
  for (const id of fingerStates.keys()) {
    if (!seenFingers.has(id) && !fingerStates.get(id)!.pressed) {
      fingerStates.delete(id);
    }
  }
}

function releaseAllNotes() {
  if (callbacks) {
    for (const [, midi] of activeFingerNotes) {
      callbacks.onNoteOff(midi);
    }
  }
  activeFingerNotes.clear();
  fingerStates.clear();
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

export const CAMERA_PRESS_Y = PRESS_Y;
