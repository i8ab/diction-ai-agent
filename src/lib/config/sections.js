import { EN_LETTERS, AR_LETTERS } from "../utils/searchUtils";

// Configuration for dictionary sections. Tab order: Academic → English → Arabic.
// Each section defines direction, accent colors, placeholders/fonts for word
// and meaning fields, and the letter set used for the A-Z browser.
export const SECTIONS = {
  academic: {
    label: "Academic", shortLabel: "Academic", dir: "ltr",
    accent: "var(--accent-1)", accentSoft: "var(--accent-1-soft)",
    wordPlaceholder: "Word in English", wordDir: "ltr", wordFont: "'Fraunces', serif",
    meaningPlaceholder: "المعنى بالعربية", meaningDir: "rtl", meaningFont: "'Amiri', serif",
    letters: EN_LETTERS,
    hasUnits: true,
  },
  "en-ar": {
    label: "English → Arabic", shortLabel: "EN → AR", dir: "ltr",
    accent: "var(--accent-1)", accentSoft: "var(--accent-1-soft)",
    wordPlaceholder: "Word in English", wordDir: "ltr", wordFont: "'Fraunces', serif",
    meaningPlaceholder: "المعنى بالعربية", meaningDir: "rtl", meaningFont: "'Amiri', serif",
    letters: EN_LETTERS,
  },
  "ar-ar": {
    label: "Arabic → Arabic", shortLabel: "AR → AR", dir: "rtl",
    accent: "var(--accent-2)", accentSoft: "var(--accent-2-soft)",
    wordPlaceholder: "الكلمة", wordDir: "rtl", wordFont: "'Amiri', serif",
    meaningPlaceholder: "الشرح بالعربية", meaningDir: "rtl", meaningFont: "'Amiri', serif",
    letters: AR_LETTERS,
  },
};
