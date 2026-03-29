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
