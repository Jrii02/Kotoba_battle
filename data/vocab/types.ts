export type Category = "verb" | "adjective" | "noun" | "adverb";

export type Word = {
  id: number;
  kanji: string;
  kana: string;
  meaning: string;
  category: Category;
};

// Offset ID per kategori agar id tetap unik secara global ketika digabung.
// Maks 9.999 entri per kategori (jauh di atas kebutuhan 737).
export const ID_OFFSET: Record<Category, number> = {
  verb: 10000,
  adjective: 20000,
  noun: 30000,
  adverb: 40000,
};
