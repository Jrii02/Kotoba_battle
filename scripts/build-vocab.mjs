#!/usr/bin/env node
// Generate data/vocab/{verbs,adjectives,nouns,adverbs}.ts dari CSV di data/csv/.
// Pakai: npm run build-vocab
//
// Format setiap CSV (urutan kolom): kanji, kana (hiragana), meaning (arti)
// Baris pertama diasumsikan header dan dilewati.
// Jika kolom `kanji` kosong, otomatis di-fallback ke `kana`.
//
// File CSV bersifat opsional — kategori yang tidak punya CSV akan dilewati
// (file TS-nya tetap dipertahankan apa adanya).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CATEGORIES = [
  { id: "verb", file: "verbs", varName: "VERBS", offset: 10000 },
  { id: "adjective", file: "adjectives", varName: "ADJECTIVES", offset: 20000 },
  { id: "noun", file: "nouns", varName: "NOUNS", offset: 30000 },
  { id: "adverb", file: "adverbs", varName: "ADVERBS", offset: 40000 },
];

// Parser CSV minimal sesuai RFC 4180 (handle koma & newline di dalam quote).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function buildCategory(cat) {
  const csvPath = resolve(`data/csv/${cat.file}.csv`);
  const outPath = resolve(`data/vocab/${cat.file}.ts`);

  if (!existsSync(csvPath)) {
    console.log(`⚠ Lewati ${cat.id}: ${csvPath} tidak ada (file TS tetap apa adanya).`);
    return { skipped: true };
  }

  const csvText = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const allRows = parseCSV(csvText).filter((r) => r.some((c) => c.trim() !== ""));

  if (allRows.length === 0) {
    console.log(`⚠ Lewati ${cat.id}: CSV kosong.`);
    return { skipped: true };
  }

  const dataRows = allRows.slice(1); // skip header

  const entries = dataRows
    .map((cols, idx) => {
      const [kanjiRaw = "", kanaRaw = "", meaningRaw = ""] = cols;
      const kana = kanaRaw.trim();
      const kanji = kanjiRaw.trim() || kana;
      const meaning = meaningRaw.trim();
      return { id: cat.offset + idx + 1, kanji, kana, meaning };
    })
    .filter((e) => e.kana && e.meaning);

  if (entries.length === 0) {
    console.log(`⚠ Lewati ${cat.id}: tidak ada baris valid (kana & meaning wajib).`);
    return { skipped: true };
  }

  const lines = [
    `// AUTO-GENERATED dari data/csv/${cat.file}.csv — JANGAN EDIT MANUAL.`,
    "// Jalankan `npm run build-vocab` untuk regenerate.",
    'import type { Word } from "./types";',
    "",
    `export const ${cat.varName}: Word[] = [`,
    ...entries.map(
      (e) =>
        `  { id: ${e.id}, kanji: "${escape(e.kanji)}", kana: "${escape(e.kana)}", meaning: "${escape(e.meaning)}", category: "${cat.id}" },`,
    ),
    "];",
    "",
  ];

  writeFileSync(outPath, lines.join("\n"), "utf8");
  return { skipped: false, count: entries.length, outPath };
}

console.log("📚 Build vocab dari CSV...\n");
let total = 0;
let generated = 0;
for (const cat of CATEGORIES) {
  const result = buildCategory(cat);
  if (!result.skipped) {
    console.log(`✔ ${cat.varName.padEnd(11)} : ${result.count.toString().padStart(4)} kata → ${result.outPath}`);
    total += result.count;
    generated++;
  }
}
console.log(`\n✨ Selesai. ${generated} file ter-generate, total ${total} kosakata.`);
if (generated === 0) {
  console.log("   Letakkan CSV di data/csv/{verbs,adjectives,nouns,adverbs}.csv lalu jalankan ulang.");
}
