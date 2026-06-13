import { ADJECTIVES } from "./adjectives";
import { ADVERBS } from "./adverbs";
import { NOUNS } from "./nouns";
import type { Category, Word } from "./types";
import { VERBS } from "./verbs";

export type { Category, Word } from "./types";
export { ADJECTIVES, ADVERBS, NOUNS, VERBS };

export const ALL_VOCAB: Word[] = [
  ...VERBS,
  ...ADJECTIVES,
  ...NOUNS,
  ...ADVERBS,
];

export type ModeId = Category | "mixed";

export type Mode = {
  id: ModeId;
  label: string;
  emoji: string;
  description: string;
  words: Word[];
};

export const MODES: Mode[] = [
  {
    id: "verb",
    label: "Kata Kerja",
    emoji: "🏃",
    description: "Fokus pada doushi (動詞)",
    words: VERBS,
  },
  {
    id: "adjective",
    label: "Kata Sifat",
    emoji: "🎨",
    description: "Fokus pada keiyoushi (形容詞)",
    words: ADJECTIVES,
  },
  {
    id: "noun",
    label: "Kata Benda",
    emoji: "📦",
    description: "Fokus pada meishi (名詞)",
    words: NOUNS,
  },
  {
    id: "adverb",
    label: "Kata Keterangan",
    emoji: "⏱",
    description: "Fokus pada fukushi (副詞)",
    words: ADVERBS,
  },
  {
    id: "mixed",
    label: "Campuran",
    emoji: "🎲",
    description: "Acak dari semua kategori",
    words: ALL_VOCAB,
  },
];
