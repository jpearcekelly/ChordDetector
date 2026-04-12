// Default note names — overridden by key-aware names when a key is set
const DEFAULT_NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// All intervals stored as pitch classes (mod 12), sorted ascending.
// priority: higher = preferred when ambiguous (simpler/more common chords win)
type ChordPattern = {
  intervals: number[];
  suffix: string;
  priority: number;
};

// Common alternative names for chord suffixes (jazz/pop conventions)
const SUFFIX_ALIASES: Record<string, string> = {
  "m7b5": "ø7",
  "dim7": "°7",
  "dim": "°",
  "aug": "+",
  "aug7": "+7",
  "augMaj7": "+maj7",
  "mMaj7": "m△7",
  "mMaj9": "m△9",
  "maj7": "△7",
  "maj9": "△9",
  "maj11": "△11",
  "maj13": "△13",
};

const CHORD_PATTERNS: ChordPattern[] = [
  // ── 7-note (13th chords / full voicings) ────────
  { intervals: [0, 2, 4, 5, 7, 9, 10], suffix: "13", priority: 5 },
  { intervals: [0, 2, 4, 5, 7, 9, 11], suffix: "maj13", priority: 5 },
  { intervals: [0, 2, 3, 5, 7, 9, 10], suffix: "m13", priority: 5 },
  // b13 voicings (Lydian b6 sound — both natural 5 and b13 present)
  { intervals: [0, 2, 4, 5, 7, 8, 11], suffix: "maj7b13", priority: 4 },
  { intervals: [0, 2, 4, 5, 7, 8, 10], suffix: "7b13", priority: 4 },
  { intervals: [0, 2, 3, 5, 7, 8, 10], suffix: "m7b13", priority: 4 },

  // ── 6-note (11th chords / partial 13ths) ───────
  { intervals: [0, 2, 4, 5, 7, 10], suffix: "11", priority: 6 },
  { intervals: [0, 2, 4, 5, 7, 11], suffix: "maj11", priority: 6 },
  { intervals: [0, 2, 3, 5, 7, 10], suffix: "m11", priority: 6 },
  { intervals: [0, 2, 4, 6, 7, 10], suffix: "7#11", priority: 4 },
  { intervals: [0, 2, 4, 6, 7, 11], suffix: "maj7#11", priority: 4 },
  // 13 without 11 (very common voicing)
  { intervals: [0, 2, 4, 7, 9, 10], suffix: "13", priority: 6 },
  { intervals: [0, 2, 4, 7, 9, 11], suffix: "maj13", priority: 6 },
  { intervals: [0, 2, 3, 7, 9, 10], suffix: "m13", priority: 6 },
  // b13 without 11
  { intervals: [0, 2, 4, 7, 8, 10], suffix: "7b13", priority: 5 },
  { intervals: [0, 2, 4, 7, 8, 11], suffix: "maj7b13", priority: 5 },
  { intervals: [0, 2, 3, 7, 8, 10], suffix: "m7b13", priority: 5 },
  // altered 6-note
  { intervals: [0, 1, 4, 7, 8, 10], suffix: "7b9b13", priority: 3 },

  // ── 5-note (9th chords / altered dominants) ────
  { intervals: [0, 2, 4, 7, 11], suffix: "maj9", priority: 7 },
  { intervals: [0, 2, 4, 7, 10], suffix: "9", priority: 7 },
  { intervals: [0, 2, 3, 7, 10], suffix: "m9", priority: 7 },
  { intervals: [0, 2, 4, 7, 9], suffix: "6/9", priority: 6 },
  { intervals: [0, 2, 3, 7, 9], suffix: "m6/9", priority: 5 },
  { intervals: [0, 1, 4, 7, 10], suffix: "7b9", priority: 5 },
  { intervals: [0, 3, 4, 7, 10], suffix: "7#9", priority: 5 },
  { intervals: [0, 4, 6, 7, 10], suffix: "7#11", priority: 4 },
  { intervals: [0, 4, 6, 7, 11], suffix: "maj7#11", priority: 4 },
  { intervals: [0, 4, 7, 8, 10], suffix: "7b13", priority: 4 },
  { intervals: [0, 4, 7, 8, 11], suffix: "maj7b13", priority: 4 },
  { intervals: [0, 3, 7, 8, 10], suffix: "m7b13", priority: 4 },
  { intervals: [0, 2, 5, 7, 10], suffix: "9sus4", priority: 5 },
  { intervals: [0, 2, 3, 7, 11], suffix: "mMaj9", priority: 5 },
  { intervals: [0, 3, 7, 9, 11], suffix: "m6maj7", priority: 5 },
  { intervals: [0, 4, 7, 9, 11], suffix: "6maj7", priority: 5 },

  // ── 4-note (7th chords) ────────────────────────
  { intervals: [0, 4, 7, 11], suffix: "maj7", priority: 9 },
  { intervals: [0, 3, 7, 10], suffix: "m7", priority: 9 },
  { intervals: [0, 4, 7, 10], suffix: "7", priority: 9 },
  { intervals: [0, 3, 6, 10], suffix: "m7b5", priority: 8 },
  { intervals: [0, 3, 6, 9], suffix: "dim7", priority: 8 },
  { intervals: [0, 4, 8, 10], suffix: "aug7", priority: 7 },
  { intervals: [0, 4, 8, 11], suffix: "augMaj7", priority: 6 },
  { intervals: [0, 3, 7, 11], suffix: "mMaj7", priority: 7 },
  { intervals: [0, 4, 7, 9], suffix: "6", priority: 8 },
  { intervals: [0, 3, 7, 9], suffix: "m6", priority: 8 },
  { intervals: [0, 2, 4, 7], suffix: "add9", priority: 7 },
  { intervals: [0, 4, 5, 7], suffix: "add4", priority: 6 },
  { intervals: [0, 2, 3, 7], suffix: "madd9", priority: 6 },
  { intervals: [0, 5, 7, 10], suffix: "7sus4", priority: 8 },
  { intervals: [0, 2, 7, 10], suffix: "7sus2", priority: 7 },
  { intervals: [0, 5, 7, 11], suffix: "maj7sus4", priority: 6 },
  { intervals: [0, 2, 7, 11], suffix: "maj7sus2", priority: 6 },
  { intervals: [0, 4, 6, 10], suffix: "7b5", priority: 6 },

  // ── 3-note (triads) ───────────────────────────
  { intervals: [0, 4, 7], suffix: "maj", priority: 10 },
  { intervals: [0, 3, 7], suffix: "min", priority: 10 },
  { intervals: [0, 3, 6], suffix: "dim", priority: 9 },
  { intervals: [0, 4, 8], suffix: "aug", priority: 9 },
  { intervals: [0, 2, 7], suffix: "sus2", priority: 8 },
  { intervals: [0, 5, 7], suffix: "sus4", priority: 8 },
  { intervals: [0, 4, 6], suffix: "(b5)", priority: 5 },
  { intervals: [0, 3, 8], suffix: "m(#5)", priority: 4 },

  // ── 2-note ────────────────────────────────────
  { intervals: [0, 7], suffix: "5", priority: 6 },
];

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Check if every element of `small` appears in `large` (both sorted)
function isSubset(small: number[], large: number[]): boolean {
  let li = 0;
  for (const s of small) {
    while (li < large.length && large[li] < s) li++;
    if (li >= large.length || large[li] !== s) return false;
    li++;
  }
  return true;
}

type Interpretation = {
  name: string;
  root: number; // pitch class of chord root
  suffix: string;
  score: number;
  exact: boolean;
  inversion: string | null;
  missingNotes: number[]; // pitch classes in the pattern but not played
};

export type ChordResult = {
  name: string;
  root: number; // pitch class of chord root
  suffix: string;
  exact: boolean;
  inversion: string | null; // e.g. "2nd inv." — separate from name for styling
  missingNotes: number[]; // pitch classes not played but in the matched pattern
  alternatives: string[];
};

// Count how many notes in the lower registers reinforce a given pitch class.
// Notes below MIDI 60 (C4) are considered "bass register."
function bassWeight(notes: Set<number>, pitchClass: number): number {
  let count = 0;
  for (const n of notes) {
    if (n < 60 && n % 12 === pitchClass) count++;
  }
  return count;
}

// Diatonic pitch classes for each key mode (semitone offsets from tonic)
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

type KeyInfo = { tonic: number; mode: "major" | "minor" } | null;

export function detectChord(
  notes: Set<number>,
  noteNames: string[] = DEFAULT_NOTE_NAMES,
  key: KeyInfo = null,
): ChordResult {
  if (notes.size === 0) return { name: "—", root: -1, suffix: "", exact: true, inversion: null, missingNotes: [], alternatives: [] };

  if (notes.size === 1) {
    const note = notes.values().next().value!;
    return { name: noteNames[note % 12], root: note % 12, suffix: "", exact: true, inversion: null, missingNotes: [], alternatives: [] };
  }

  const pitchClasses = [...new Set([...notes].map((n) => n % 12))].sort((a, b) => a - b);
  const bassNote = Math.min(...notes) % 12;
  const bassReinforcement = bassWeight(notes, bassNote);

  const interpretations: Interpretation[] = [];

  for (const root of pitchClasses) {
    const intervals = pitchClasses
      .map((pc) => (pc - root + 12) % 12)
      .sort((a, b) => a - b);

    const rootIsBass = root === bassNote;

    for (const pattern of CHORD_PATTERNS) {
      const pLen = pattern.intervals.length;
      const iLen = intervals.length;

      let matchType: "exact" | "subset-up" | "subset-down" | null = null;

      if (arraysEqual(pattern.intervals, intervals)) {
        matchType = "exact";
      } else if (iLen < pLen && pLen <= iLen + 2 && isSubset(intervals, pattern.intervals)) {
        matchType = "subset-up";
      } else if (iLen > pLen && pLen >= 3 && isSubset(pattern.intervals, intervals)) {
        matchType = "subset-down";
      }

      if (!matchType) continue;

      let score = 0;

      // Match quality — coverage matters more for subset matches
      if (matchType === "exact") score += 100 + 20;
      else if (matchType === "subset-up") score += 50 + (iLen / pLen) * 30;
      else score += 30 + (pLen / iLen) * 15;

      // Bass analysis:
      // - Exact match with root=bass: full bonus, amplified by reinforcement
      // - Non-exact with root=bass: modest flat bonus (don't let reinforcement
      //   overwhelm a better-fitting chord from another root)
      // - Root≠bass but bass is a chord tone: credit for plausible slash chord
      if (rootIsBass) {
        if (matchType === "exact") {
          score += 40 * Math.max(1, bassReinforcement);
        } else {
          // Modest bonus + small reinforcement scaling for non-exact
          score += 20 + Math.min(bassReinforcement * 5, 15);
        }
      } else {
        const bassInterval = (bassNote - root + 12) % 12;
        if (pattern.intervals.includes(bassInterval)) {
          score += 20; // bass is a chord tone — makes sense as a slash chord
        }
      }

      // Key-aware scoring: diatonic chords get a bonus, tonic gets the most
      if (key) {
        const scale = key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
        const degreeFromTonic = (root - key.tonic + 12) % 12;
        if (degreeFromTonic === 0) {
          score += 30; // tonic chord — strongest preference
        } else if (scale.includes(degreeFromTonic)) {
          score += 15; // diatonic chord
        }
      }

      // Prefer common chords
      score += pattern.priority;

      const chordName = noteNames[root] + pattern.suffix;

      // For triads (3-note exact match), use inversion labels instead of slash notation.
      // For larger chords, use slash notation.
      const highCoverage = matchType === "subset-up" && iLen / pLen >= 0.75;
      const isInvertedTriad = matchType === "exact" && !rootIsBass && pLen === 3;
      let displayName = chordName;
      let inversionLabel: string | null = null;

      if (isInvertedTriad) {
        const INVERSIONS = ["", "1st inv.", "2nd inv."];
        const bassInterval = (bassNote - root + 12) % 12;
        const bassPos = pattern.intervals.indexOf(bassInterval);
        if (bassPos >= 1 && bassPos < INVERSIONS.length) {
          inversionLabel = INVERSIONS[bassPos];
        } else {
          displayName = `${chordName}/${noteNames[bassNote]}`;
        }
      } else if ((matchType === "exact" || highCoverage) && !rootIsBass) {
        displayName = `${chordName}/${noteNames[bassNote]}`;
      }

      // Compute missing notes: pattern intervals not in played intervals
      const missing: number[] = [];
      if (matchType === "subset-up") {
        for (const pi of pattern.intervals) {
          if (!intervals.includes(pi)) {
            missing.push((pi + root) % 12);
          }
        }
      }

      interpretations.push({
        name: displayName,
        root,
        suffix: pattern.suffix,
        score,
        exact: matchType === "exact",
        inversion: inversionLabel,
        missingNotes: missing,
      });
    }
  }

  if (interpretations.length === 0) {
    return { name: "?", root: -1, suffix: "", exact: false, inversion: null, missingNotes: [], alternatives: [] };
  }

  // Sort by score descending
  interpretations.sort((a, b) => b.score - a.score);

  // Dedupe by name, keeping highest-scored version
  const seen = new Set<string>();
  const unique: Interpretation[] = [];
  for (const interp of interpretations) {
    if (!seen.has(interp.name)) {
      seen.add(interp.name);
      unique.push(interp);
    }
  }

  const primary = unique[0];

  // Extract root note from a chord name (e.g. "Cm9/G" → "C", "D#maj13" → "D#")
  function chordRoot(name: string): string {
    const base = name.split("/")[0]; // strip slash
    if (base.length >= 2 && base[1] === "#") return base.slice(0, 2);
    return base.slice(0, 1);
  }

  // Alternatives: only show genuinely different interpretations.
  // - If primary is exact, only show other exact matches
  // - Only one interpretation per root note (no Cm9 + Cm11 + Cm13)
  const primaryRoot = chordRoot(primary.name);
  const seenRoots = new Set([primaryRoot]);
  const alternatives: string[] = [];

  for (const interp of unique.slice(1)) {
    if (primary.exact && !interp.exact) continue;
    const root = chordRoot(interp.name);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    alternatives.push(interp.name);
    if (alternatives.length >= 2) break;
  }

  // Add contextual alternative based on whether primary uses inversion or slash:
  // - Triads with inversion label as primary → add slash version as alternative
  // - Slash chords as primary → add inversion/bass-tone description as alternative
  if (primary.exact) {
    if (primary.inversion) {
      // Primary is a triad inversion — add slash notation as alternative
      const slashAlt = `${primary.name}/${noteNames[bassNote]}`;
      if (!alternatives.includes(slashAlt)) {
        alternatives.unshift(slashAlt);
        if (alternatives.length > 3) alternatives.pop();
      }
    } else if (primary.name.includes("/")) {
      // Primary uses slash notation — add inversion/bass description as alternative
      const slashIdx = primary.name.indexOf("/");
      const chordPart = primary.name.slice(0, slashIdx);

      for (const root of pitchClasses) {
        const rootName = noteNames[root];
        if (!chordPart.startsWith(rootName)) continue;
        const suffix = chordPart.slice(rootName.length);
        const intervals = pitchClasses
          .map((pc) => (pc - root + 12) % 12)
          .sort((a, b) => a - b);
        const bassInterval = (bassNote - root + 12) % 12;

        for (const pattern of CHORD_PATTERNS) {
          if (pattern.suffix !== suffix) continue;
          if (!arraysEqual(pattern.intervals, intervals)) continue;
          const bassPos = pattern.intervals.indexOf(bassInterval);
          if (bassPos >= 1) {
            const TONE_NAMES: Record<number, string> = {
              2: "9th", 3: "minor 3rd", 4: "major 3rd", 5: "4th", 6: "b5",
              7: "5th", 8: "b6", 9: "6th", 10: "b7", 11: "maj7",
            };
            const toneName = TONE_NAMES[bassInterval] ?? "bass";
            const invLabel = `${chordPart} (${toneName} in bass)`;
            if (!alternatives.includes(invLabel)) {
              alternatives.unshift(invLabel);
              if (alternatives.length > 3) alternatives.pop();
            }
          }
          break;
        }
        break;
      }
    }
  }

  // Always ensure a bass-rooted interpretation appears in alternatives.
  // Even if it's a fuzzy match, it gives the "what if the bass IS the root?" perspective.
  const bassRootName = noteNames[bassNote];
  const hasBassRootAlt = chordRoot(primary.name) === bassRootName ||
    alternatives.some((a) => chordRoot(a) === bassRootName);

  if (!hasBassRootAlt && pitchClasses.includes(bassNote)) {
    // Find the best bass-rooted interpretation from all interpretations
    const bassRooted = interpretations.find(
      (i) => chordRoot(i.name) === bassRootName && !i.name.includes("/"),
    );
    if (bassRooted) {
      alternatives.push(bassRooted.name);
      if (alternatives.length > 3) alternatives.shift();
    }
  }

  // Add alias name (e.g. ø7 for m7b5, △7 for maj7) as first alternative
  const alias = SUFFIX_ALIASES[primary.suffix];
  if (alias) {
    const rootName = noteNames[primary.root];
    const aliasName = `${rootName}${alias}`;
    if (!alternatives.includes(aliasName)) {
      alternatives.unshift(aliasName);
      if (alternatives.length > 4) alternatives.pop();
    }
  }

  return {
    name: primary.name,
    root: primary.root,
    suffix: primary.suffix,
    exact: primary.exact,
    inversion: primary.inversion,
    missingNotes: primary.missingNotes,
    alternatives,
  };
}

export function noteName(midi: number, noteNames: string[] = DEFAULT_NOTE_NAMES): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[midi % 12]}${octave}`;
}
