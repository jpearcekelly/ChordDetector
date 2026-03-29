import * as Tone from "tone";

let sampler: Tone.Sampler | null = null;
let compressor: Tone.Compressor | null = null;
let limiter: Tone.Limiter | null = null;
let started = false;

function midiToNote(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

async function ensureStarted() {
  if (!started) {
    await Tone.start();
    started = true;
  }
}

export function getAudioEngine() {
  if (!sampler) {
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
      volume: -12, // more headroom — piano samples are hot
    });

    // Compressor: aggressive settings to keep stacked chords under control
    compressor = new Tone.Compressor({
      threshold: -30, // engage earlier
      ratio: 8,       // squeeze harder
      attack: 0.002,  // clamp fast transients
      release: 0.15,
      knee: 10,       // soft knee for natural feel
    });

    // Hard limiter — nothing above -2 dB reaches the speakers
    limiter = new Tone.Limiter(-2);

    sampler.chain(compressor, limiter, Tone.getDestination());
  }
  return sampler;
}

export async function noteOn(midi: number, _velocity: number) {
  await ensureStarted();
  const engine = getAudioEngine();
  engine.triggerAttack(midiToNote(midi));
}

export function noteOff(midi: number) {
  sampler?.triggerRelease(midiToNote(midi));
}

export function allNotesOff() {
  sampler?.releaseAll();
}
