import type { ModeId } from "@/data/vocab";

const STORAGE_KEY = "kotoba-battle:v1";

export type HighScore = {
  bestWave: number;
  bestKills: number;
  bestAPM: number;
  bestAccuracy: number;
  updatedAt: number;
};

export type WordStat = {
  wrongCount: number;
  seenCount: number;
};

export type StatsData = {
  highScores: Partial<Record<ModeId, HighScore>>;
  wordStats: Record<number, WordStat>;
};

const EMPTY: StatsData = { highScores: {}, wordStats: {} };

function read(): StatsData {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      highScores: parsed?.highScores ?? {},
      wordStats: parsed?.wordStats ?? {},
    };
  } catch {
    return EMPTY;
  }
}

function write(data: StatsData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota / privacy errors
  }
}

export function loadHighScores(): Partial<Record<ModeId, HighScore>> {
  return read().highScores;
}

export function loadWordStats(): Record<number, WordStat> {
  return read().wordStats;
}

export function recordAnswer(wordId: number, correct: boolean) {
  const data = read();
  const cur = data.wordStats[wordId] ?? { wrongCount: 0, seenCount: 0 };
  cur.seenCount += 1;
  if (!correct) cur.wrongCount += 1;
  data.wordStats[wordId] = cur;
  write(data);
}

export type RunResult = {
  wave: number;
  kills: number;
  apm: number;
  accuracy: number;
};

export type HighScoreDelta = {
  newBestWave: boolean;
  newBestAPM: boolean;
  newBestAccuracy: boolean;
  previous?: HighScore;
};

export function saveHighScore(modeId: ModeId, run: RunResult): HighScoreDelta {
  const data = read();
  const prev = data.highScores[modeId];
  const delta: HighScoreDelta = {
    newBestWave: !prev || run.wave > prev.bestWave,
    newBestAPM: !prev || run.apm > prev.bestAPM,
    newBestAccuracy: !prev || run.accuracy > prev.bestAccuracy,
    previous: prev,
  };
  data.highScores[modeId] = {
    bestWave: Math.max(prev?.bestWave ?? 0, run.wave),
    bestKills: Math.max(prev?.bestKills ?? 0, run.kills),
    bestAPM: Math.max(prev?.bestAPM ?? 0, run.apm),
    bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, run.accuracy),
    updatedAt: Date.now(),
  };
  write(data);
  return delta;
}

export function resetAll() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
