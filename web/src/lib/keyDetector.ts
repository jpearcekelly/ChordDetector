// Krumhansl-Kessler key profiles — empirically derived weights for how often
// each pitch class appears in music of a given key.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Enharmonic note names per key-signature type
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Default spelling when no key is set — uses the most common enharmonic for each pitch class
const DEFAULT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Which keys use flats vs sharps
// Major: F Bb Eb Ab Db Gb = pitch classes 5, 10, 3, 8, 1, 6
// Minor: D G C F Bb Eb = pitch classes 2, 7, 0, 5, 10, 3
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1, 6]);
const FLAT_MINOR_KEYS = new Set([2, 7, 0, 5, 10, 3]);

export type Key = {
  tonic: number; // pitch class 0-11
  mode: "major" | "minor";
};

export type KeyResult = {
  key: Key;
  confidence: number; // 0-1, how strong the correlation is
};

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

// Rotate an array by `offset` positions
function rotate<T>(arr: T[], offset: number): T[] {
  const n = arr.length;
  const o = ((offset % n) + n) % n;
  return [...arr.slice(o), ...arr.slice(0, o)];
}

/**
 * Detect the most likely key from a pitch class histogram.
 * The histogram is a 12-element array where index = pitch class, value = weight.
 */
export function detectKey(histogram: number[]): KeyResult | null {
  if (histogram.every((v) => v === 0)) return null;

  let bestKey: Key = { tonic: 0, mode: "major" };
  let bestCorr = -Infinity;
  let secondCorr = -Infinity;

  for (let tonic = 0; tonic < 12; tonic++) {
    // Rotate the histogram so `tonic` is at index 0
    const rotated = rotate(histogram, tonic);

    const corrMajor = pearsonCorrelation(rotated, MAJOR_PROFILE);
    if (corrMajor > bestCorr) {
      secondCorr = bestCorr;
      bestCorr = corrMajor;
      bestKey = { tonic, mode: "major" };
    } else if (corrMajor > secondCorr) {
      secondCorr = corrMajor;
    }

    const corrMinor = pearsonCorrelation(rotated, MINOR_PROFILE);
    if (corrMinor > bestCorr) {
      secondCorr = bestCorr;
      bestCorr = corrMinor;
      bestKey = { tonic, mode: "minor" };
    } else if (corrMinor > secondCorr) {
      secondCorr = corrMinor;
    }
  }

  // Confidence: how much better the best key is compared to the second best
  // Normalized to 0-1 range
  const confidence = Math.max(0, Math.min(1, (bestCorr - secondCorr) * 2));

  return { key: bestKey, confidence };
}

/**
 * Get the appropriate note names for a given key (or default if null).
 */
export function noteNamesForKey(key: Key | null): string[] {
  if (!key) return DEFAULT_NAMES;
  const usesFlats =
    key.mode === "major"
      ? FLAT_MAJOR_KEYS.has(key.tonic)
      : FLAT_MINOR_KEYS.has(key.tonic);
  return usesFlats ? FLAT_NAMES : SHARP_NAMES;
}

/**
 * Format a key for display: e.g. "Cm", "G", "Eb", "F#m"
 */
export function formatKey(key: Key): string {
  const names = noteNamesForKey(key);
  return names[key.tonic] + (key.mode === "minor" ? "m" : "");
}

/**
 * All 24 keys, ordered by circle of fifths for the dropdown
 */
export function allKeys(): Key[] {
  const keys: Key[] = [];
  // Major keys by circle of fifths: C G D A E B F# Gb Db Ab Eb Bb F
  const majorOrder = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  for (const tonic of majorOrder) {
    keys.push({ tonic, mode: "major" });
  }
  // Minor keys by circle of fifths: Am Em Bm F#m C#m G#m Ebm Bbm Fm Cm Gm Dm
  const minorOrder = [9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2];
  for (const tonic of minorOrder) {
    keys.push({ tonic, mode: "minor" });
  }
  return keys;
}

// ── Scale / mode definitions ────────────────────
export type ScaleMode = {
  name: string;
  intervals: number[];
  category: "diatonic" | "minor-variant" | "pentatonic";
};

export const SCALE_MODES: ScaleMode[] = [
  // Diatonic modes
  { name: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11], category: "diatonic" },
  { name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10], category: "diatonic" },
  { name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10], category: "diatonic" },
  { name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11], category: "diatonic" },
  { name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10], category: "diatonic" },
  { name: "Minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10], category: "diatonic" },
  { name: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10], category: "diatonic" },
  // Minor variants
  { name: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11], category: "minor-variant" },
  { name: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11], category: "minor-variant" },
  // Pentatonic / blues
  { name: "Major Pentatonic", intervals: [0, 2, 4, 7, 9], category: "pentatonic" },
  { name: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10], category: "pentatonic" },
  { name: "Blues", intervals: [0, 3, 5, 6, 7, 10], category: "pentatonic" },
];

/** Get pitch classes for a scale given a tonic and mode */
export function scaleNotes(tonic: number, mode: ScaleMode): number[] {
  return mode.intervals.map((i) => (tonic + i) % 12);
}

// ── Right-hand ascending fingerings ─────────────
// Standard fingerings for major scales by tonic pitch class
// Each array has 7 entries = fingers for scale degrees 1-7
const RH_MAJOR_FINGERINGS: Record<number, number[]> = {
  0:  [1, 2, 3, 1, 2, 3, 4], // C
  1:  [2, 3, 1, 2, 3, 4, 1], // Db
  2:  [1, 2, 3, 1, 2, 3, 4], // D
  3:  [3, 1, 2, 3, 4, 1, 2], // Eb
  4:  [1, 2, 3, 1, 2, 3, 4], // E
  5:  [1, 2, 3, 4, 1, 2, 3], // F
  6:  [2, 3, 4, 1, 2, 3, 1], // F#/Gb
  7:  [1, 2, 3, 1, 2, 3, 4], // G
  8:  [3, 4, 1, 2, 3, 1, 2], // Ab
  9:  [1, 2, 3, 1, 2, 3, 4], // A
  10: [4, 1, 2, 3, 1, 2, 3], // Bb
  11: [1, 2, 3, 1, 2, 3, 4], // B
};

/**
 * Get RH fingering for a scale. Returns a Map of pitch class → finger number (1-5).
 * For modes, derives fingering from the parent major scale.
 * For pentatonic/blues, uses a simplified 1-2-3-4-5 approach.
 */
export function scaleFingering(tonic: number, mode: ScaleMode): Map<number, number> {
  const result = new Map<number, number>();
  const notes = scaleNotes(tonic, mode);

  if (mode.category === "pentatonic") {
    // Pentatonic/blues: simple 1-2-3-1-2 or 1-2-3-1-2-3 pattern
    const fingers = notes.length === 5 ? [1, 2, 3, 1, 2] : [1, 2, 3, 1, 2, 3];
    notes.forEach((pc, i) => result.set(pc, fingers[i]));
    return result;
  }

  if (mode.category === "diatonic") {
    // Diatonic modes: find the parent major scale and rotate the fingering
    // The Ionian mode of this key uses the standard major fingering.
    // Other modes are rotations — e.g. D Dorian = C major starting from degree 2
    const modeIndex = SCALE_MODES.findIndex((m) => m.name === mode.name);
    // Diatonic modes are indices 0-6 in SCALE_MODES, matching mode degrees 0-6
    const rotation = modeIndex >= 0 && modeIndex < 7 ? modeIndex : 0;
    // For D Dorian: parent major = C major. D is degree 2 of C major.
    // parentTonic = tonic - majorIntervals[rotation]
    const majorIntervals = SCALE_MODES[0].intervals;
    const correctedParentTonic = (tonic - majorIntervals[rotation] + 12) % 12;
    const parentFingering = RH_MAJOR_FINGERINGS[correctedParentTonic] ?? [1, 2, 3, 1, 2, 3, 4];

    // Rotate the parent fingering by the mode offset
    for (let i = 0; i < 7; i++) {
      const fingerIdx = (i + rotation) % 7;
      result.set(notes[i], parentFingering[fingerIdx]);
    }
    return result;
  }

  // Minor variants: use the fingering of the parallel natural minor as a base
  // (harmonic/melodic minor have the same fingering pattern as natural minor
  //  except for the raised 6th/7th which keep the same fingers)
  const minorMode = SCALE_MODES[5]; // Aeolian
  const minorFingering = scaleFingering(tonic, minorMode);
  notes.forEach((pc) => {
    // If this note is in the natural minor, use that fingering
    if (minorFingering.has(pc)) {
      result.set(pc, minorFingering.get(pc)!);
    } else {
      // Raised note: use the finger of the note it replaces
      // Find the closest natural minor degree
      const minorNotes = scaleNotes(tonic, minorMode);
      const idx = notes.indexOf(pc);
      if (idx >= 0 && idx < minorNotes.length) {
        result.set(pc, minorFingering.get(minorNotes[idx]) ?? 1);
      }
    }
  });
  return result;
}

/**
 * Get the Roman numeral for a chord given a key.
 * Returns e.g. "I", "iv", "V", "bVI", "ii°" etc.
 * chordRoot: pitch class of chord root (0-11)
 * chordSuffix: the chord suffix from detection (e.g. "", "m", "dim", "7", "maj7")
 */
export function romanNumeral(
  chordRoot: number,
  chordSuffix: string,
  key: Key,
): string | null {
  const interval = (chordRoot - key.tonic + 12) % 12;

  // Scale degree names by semitone distance from tonic
  const DEGREE_NAMES: Record<number, string> = {
    0: "I", 1: "bII", 2: "II", 3: "bIII", 4: "III", 5: "IV",
    6: "bV", 7: "V", 8: "bVI", 9: "VI", 10: "bVII", 11: "VII",
  };

  // In minor keys, adjust the "natural" degrees
  // (III, VI, VII are natural at b3, b6, b7 in minor)
  const MINOR_DEGREE_NAMES: Record<number, string> = {
    0: "I", 1: "bII", 2: "II", 3: "III", 4: "#III", 5: "IV",
    6: "bV", 7: "V", 8: "VI", 9: "#VI", 10: "VII", 11: "#VII",
  };

  const degreeMap = key.mode === "minor" ? MINOR_DEGREE_NAMES : DEGREE_NAMES;
  let degree = degreeMap[interval];
  if (!degree) return null;

  // Determine if chord is minor/diminished/augmented from suffix
  const isMinor = chordSuffix.startsWith("m") && !chordSuffix.startsWith("maj");
  const isDim = chordSuffix.startsWith("dim") || chordSuffix === "m7b5";
  const isAug = chordSuffix.startsWith("aug");

  // Lowercase for minor/diminished
  if (isMinor || isDim) {
    degree = degree.replace(/[IV]+/, (m) => m.toLowerCase());
  }

  // Add quality markers
  if (isDim) degree += "°";
  else if (isAug) degree += "+";

  // Add extension info for 7ths etc.
  if (chordSuffix.includes("7") || chordSuffix.includes("9") ||
      chordSuffix.includes("11") || chordSuffix.includes("13")) {
    // Extract the extension number
    const extMatch = chordSuffix.match(/(maj)?(7|9|11|13)/);
    if (extMatch) {
      const ext = extMatch[0];
      degree += ext;
    }
  }

  return degree;
}
