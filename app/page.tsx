"use client";

import { useEffect, useRef, useState } from "react";
import { ALL_VOCAB, MODES, type ModeId, type Word } from "@/data/vocab";
import {
  loadHighScores,
  loadWordStats,
  recordAnswer,
  resetAll,
  saveHighScore,
  type HighScore,
  type HighScoreDelta,
  type WordStat,
} from "@/lib/stats";

const MAX_HP = 100;
const TIME_LIMIT = 10;
const MONSTER_DMG = 25;
const PLAYER_DMG = 15;
const HEAL_AMOUNT = 20;
const REVEAL_MS = 800;

type FeedbackType = "correct" | "wrong" | "defeat" | null;
type WrongEntry = { word: Word; userAnswer: string };

function pickWeighted(
  pool: Word[],
  stats: Record<number, WordStat>,
  exclude?: number,
): Word {
  const filtered =
    exclude !== undefined && pool.length > 1
      ? pool.filter((w) => w.id !== exclude)
      : pool;
  const weights = filtered.map((w) => {
    const wrong = stats[w.id]?.wrongCount ?? 0;
    return 1 + Math.min(wrong, 5) * 2;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < filtered.length; i++) {
    r -= weights[i];
    if (r <= 0) return filtered[i];
  }
  return filtered[filtered.length - 1];
}

// Pecah field jawaban yang berisi beberapa varian (mis. "あう/あいます")
// supaya user cukup ketik salah satunya.
function expandAnswers(s: string): string[] {
  return s
    .split(/[\/／、,]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function KotobaBattlePage() {
  const [activeMode, setActiveMode] = useState<ModeId | null>(null);
  const [playerHP, setPlayerHP] = useState(MAX_HP);
  const [monsterHP, setMonsterHP] = useState(MAX_HP);
  const [wave, setWave] = useState(1);
  const [kills, setKills] = useState(0);
  const [currentWord, setCurrentWord] = useState<Word>(ALL_VOCAB[0]);
  const [input, setInput] = useState("");
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [questionNum, setQuestionNum] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [shake, setShake] = useState(false);
  const [feedback, setFeedback] = useState<{ type: FeedbackType; msg: string }>({
    type: null,
    msg: "",
  });
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tracking sesi (Round 1 — Tier 2 + WPM)
  const [revealing, setRevealing] = useState(false);
  const [revealedWord, setRevealedWord] = useState<Word | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongLog, setWrongLog] = useState<WrongEntry[]>([]);
  const [totalResponseMs, setTotalResponseMs] = useState(0);
  const questionStartRef = useRef<number>(Date.now());
  const wordStatsRef = useRef<Record<number, WordStat>>({});
  const [highScores, setHighScores] = useState<Partial<Record<ModeId, HighScore>>>(
    {},
  );
  const [lastDelta, setLastDelta] = useState<HighScoreDelta | null>(null);

  const currentMode = activeMode ? MODES.find((m) => m.id === activeMode) ?? null : null;
  const pool = currentMode?.words ?? [];
  const inGame = activeMode !== null;

  // Load stats dari localStorage saat mount (client-only).
  useEffect(() => {
    wordStatsRef.current = loadWordStats();
    setHighScores(loadHighScores());
  }, []);

  // Auto-focus input when game starts / restarts (bukan tiap soal berubah,
  // supaya keyboard HP tidak dismiss-lalu-muncul di setiap pergantian soal).
  useEffect(() => {
    if (!inGame || gameOver) return;
    inputRef.current?.focus();
  }, [inGame, gameOver]);

  // Countdown timer: restart on each new question. Pause selama reveal.
  useEffect(() => {
    if (!inGame || gameOver || revealing) return;
    setTimeLeft(TIME_LIMIT);
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [questionNum, gameOver, inGame, revealing]);

  // When timer hits zero, treat as wrong answer (no user input).
  useEffect(() => {
    if (!inGame || gameOver || revealing || timeLeft > 0) return;
    triggerWrong("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, gameOver, inGame, revealing]);

  // Monster defeat: heal player, bump wave & kills, respawn monster.
  useEffect(() => {
    if (!inGame || gameOver || monsterHP > 0) return;
    setKills((k) => k + 1);
    setWave((w) => w + 1);
    setPlayerHP((p) => Math.min(MAX_HP, p + HEAL_AMOUNT));
    setMonsterHP(MAX_HP);
    setFeedback({ type: "defeat", msg: "💀 Monster Defeated! +20 HP" });
    const t = setTimeout(
      () => setFeedback((f) => (f.type === "defeat" ? { type: null, msg: "" } : f)),
      1500,
    );
    return () => clearTimeout(t);
  }, [monsterHP, gameOver, inGame]);

  // Game over when player HP runs out.
  useEffect(() => {
    if (inGame && playerHP <= 0 && !gameOver) setGameOver(true);
  }, [playerHP, gameOver, inGame]);

  // Saat gameOver flip ke true: simpan high score + reload.
  useEffect(() => {
    if (!gameOver || !activeMode) return;
    const totalAnswered = correctCount + wrongLog.length;
    const accuracy = totalAnswered === 0 ? 0 : correctCount / totalAnswered;
    const apm =
      totalResponseMs === 0 ? 0 : totalAnswered / (totalResponseMs / 60000);
    const delta = saveHighScore(activeMode, { wave, kills, apm, accuracy });
    setLastDelta(delta);
    setHighScores(loadHighScores());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver, activeMode]);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  function advanceWord() {
    if (pool.length === 0) return;
    setCurrentWord((c) => pickWeighted(pool, wordStatsRef.current, c.id));
    setQuestionNum((q) => q + 1);
    setInput("");
    questionStartRef.current = Date.now();
    // Re-focus tanpa lewat useEffect supaya keyboard HP tidak dismiss.
    // setTimeout(0) memastikan DOM sudah selesai update sebelum focus dipanggil.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function triggerCorrect(word: Word) {
    setMonsterHP((prev) => Math.max(0, prev - MONSTER_DMG));
    setFeedback({ type: "correct", msg: "✓ Tepat!" });
    setTimeout(
      () => setFeedback((f) => (f.type === "correct" ? { type: null, msg: "" } : f)),
      REVEAL_MS,
    );
    setCorrectCount((n) => n + 1);
    recordAnswer(word.id, true);
    wordStatsRef.current = loadWordStats();
    advanceWord();
  }


  // KODE LAMA
  // function triggerWrong(userAnswer: string) {
  //   const word = currentWord;
  //   setPlayerHP((prev) => Math.max(0, prev - PLAYER_DMG));
  //   triggerShake();
  //   setFeedback({ type: "wrong", msg: "✗ Salah!" });
  //   setWrongLog((log) => [...log, { word, userAnswer }]);
  //   recordAnswer(word.id, false);
  //   wordStatsRef.current = loadWordStats();
  //   setRevealedWord(word);
  //   setRevealing(true);
  //   setTimeout(() => {
  //     setRevealing(false);
  //     setRevealedWord(null);
  //     setFeedback((f) => (f.type === "wrong" ? { type: null, msg: "" } : f));
  //     advanceWord();
  //   }, REVEAL_MS);
  // }

// KODE BARU
  function triggerWrong(userAnswer: string) {
    if (revealing) return; // Tambahan aman

    const word = currentWord;
    setPlayerHP((prev) => Math.max(0, prev - PLAYER_DMG));
    triggerShake();
    setFeedback({ type: "wrong", msg: "✗ Salah!" });
    setWrongLog((log) => [...log, { word, userAnswer }]);
    recordAnswer(word.id, false);
    wordStatsRef.current = loadWordStats();
    setRevealedWord(word);
    
    // --- KODE BARU TAMBAHAN GUE DI SINI ---
    setTimeLeft(TIME_LIMIT); 
    // -------------------------------------

    setRevealing(true);
    setTimeout(() => {
      setRevealing(false);
      setRevealedWord(null);
      setFeedback((f) => (f.type === "wrong" ? { type: null, msg: "" } : f));
      advanceWord();
    }, REVEAL_MS);
  }

  function handleSubmit() {
    if (!inGame || gameOver || revealing) return;
    const ans = input.trim();
    if (!ans) return;
    const elapsed = Date.now() - questionStartRef.current;
    setTotalResponseMs((t) => t + elapsed);
    const candidates = [
      ...expandAnswers(currentWord.kana),
      ...expandAnswers(currentWord.kanji),
    ];
    if (candidates.includes(ans)) {
      triggerCorrect(currentWord);
    } else {
      triggerWrong(ans);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Ignore Enter that is being used to commit an IME composition.
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      !isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function startMode(modeId: ModeId) {
    const mode = MODES.find((m) => m.id === modeId);
    if (!mode || mode.words.length === 0) return;
    wordStatsRef.current = loadWordStats();
    setPlayerHP(MAX_HP);
    setMonsterHP(MAX_HP);
    setWave(1);
    setKills(0);
    setInput("");
    setGameOver(false);
    setQuestionNum(0);
    setCurrentWord(pickWeighted(mode.words, wordStatsRef.current));
    setFeedback({ type: null, msg: "" });
    setTimeLeft(TIME_LIMIT);
    setRevealing(false);
    setRevealedWord(null);
    setCorrectCount(0);
    setWrongLog([]);
    setTotalResponseMs(0);
    setLastDelta(null);
    questionStartRef.current = Date.now();
    setActiveMode(modeId);
  }

  function restartCurrentMode() {
    if (activeMode) startMode(activeMode);
  }

  function backToMenu() {
    setActiveMode(null);
    setGameOver(false);
  }

  function handleResetProgress() {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      "Hapus semua progress (high score & statistik kata)? Tidak bisa di-undo.",
    );
    if (!ok) return;
    resetAll();
    wordStatsRef.current = {};
    setHighScores({});
  }

  const playerPct = (playerHP / MAX_HP) * 100;
  const monsterPct = (monsterHP / MAX_HP) * 100;
  const timePct = (timeLeft / TIME_LIMIT) * 100;
  const totalAnswered = correctCount + wrongLog.length;
  const accuracyPct = totalAnswered === 0 ? 0 : (correctCount / totalAnswered) * 100;
  const apm =
    totalResponseMs === 0 ? 0 : totalAnswered / (totalResponseMs / 60000);
  const revealKana = revealedWord?.kana ?? "";
  const revealKanji = revealedWord?.kanji ?? "";
  const showRevealKanji = revealKanji && revealKanji !== revealKana;

  return (
    <main className="kb-full-height relative overflow-hidden bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-slate-100">
      <style>{`
        @keyframes kb-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-12px); }
          40% { transform: translateX(12px); }
          60% { transform: translateX(-8px); }
          80% { transform: translateX(8px); }
        }
        .kb-shake { animation: kb-shake 0.4s ease-in-out; }
        @keyframes kb-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.6; }
        }
        .kb-pulse { animation: kb-pulse 3s ease-in-out infinite; }
        /* Fallback min-height untuk browser Android yang belum support dvh dengan benar */
        .kb-full-height {
          min-height: 100vh;
          min-height: 100dvh;
        }
        /* Game container: pakai overflow-y-auto supaya konten bisa di-scroll
           kalau viewport terhitung lebih kecil dari konten (bug dvh di beberapa HP) */
        .kb-game-container {
          min-height: 100vh;
          min-height: 100dvh;
          overflow-y: auto;
        }
      `}</style>

      <div
        aria-hidden
        className="kb-pulse pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#a855f7,transparent_45%),radial-gradient(circle_at_80%_80%,#7c3aed,transparent_45%)]"
      />

      {!inGame ? (
        <div className="kb-full-height relative mx-auto flex w-full max-w-4xl flex-col items-stretch justify-center p-4 sm:p-8">
          <header className="mb-10 text-center">
            <h1 className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-4xl font-bold tracking-wider text-transparent sm:text-5xl">
              ⚔ Kotoba Battle ⚔
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Pertarungan Kosakata Jepang — Ketik jawaban dengan IME / Kana asli
            </p>
          </header>

          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold text-purple-200">
              Pilih Mode Pertarungan
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Fokus ke satu kategori atau hadapi campuran dari semuanya
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            {MODES.map((m) => {
              const isMixed = m.id === "mixed";
              const empty = m.words.length === 0;
              const hs = highScores[m.id];
              return (
                <button
                  key={m.id}
                  onClick={() => startMode(m.id)}
                  disabled={empty}
                  className={`group rounded-2xl border-2 p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    isMixed
                      ? "border-amber-500/40 bg-gradient-to-br from-amber-950/40 to-purple-950/40 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-900/40 sm:col-span-2"
                      : "border-purple-500/30 bg-slate-900/60 hover:border-purple-400 hover:shadow-lg hover:shadow-purple-900/40"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="text-4xl">{m.emoji}</div>
                    <div className="flex-1">
                      <div className="text-lg font-bold text-slate-100">{m.label}</div>
                      <div className="text-xs text-slate-400">{m.description}</div>
                    </div>
                    <div
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                        isMixed
                          ? "bg-amber-900/40 text-amber-200"
                          : "bg-slate-800/80 text-purple-300"
                      }`}
                    >
                      {m.words.length} kata
                    </div>
                  </div>
                  {hs && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-700/60 pt-2 text-[11px] text-slate-400">
                      <span>
                        🏆 Best Wave{" "}
                        <span className="font-semibold text-amber-300">
                          {hs.bestWave}
                        </span>
                      </span>
                      <span>
                        ⚡{" "}
                        <span className="font-semibold text-cyan-300">
                          {hs.bestAPM.toFixed(1)}
                        </span>{" "}
                        APM
                      </span>
                      <span>
                        🎯{" "}
                        <span className="font-semibold text-emerald-300">
                          {(hs.bestAccuracy * 100).toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Tip: tambah kosakata di <code className="text-purple-300">data/csv/*.csv</code> lalu jalankan{" "}
            <code className="text-purple-300">npm run build-vocab</code>
          </p>

          <div className="mt-4 text-center">
            <button
              onClick={handleResetProgress}
              className="text-[11px] text-slate-600 underline-offset-4 transition-colors hover:text-rose-400 hover:underline"
            >
              ⚙ Reset Progress
            </button>
          </div>
        </div>
      ) : (
        <div className="kb-game-container relative mx-auto flex w-full max-w-4xl flex-col items-stretch justify-center p-3 pb-8 sm:p-8">
          <header className="mb-2 text-center sm:mb-4">
            <h1 className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-2xl font-bold tracking-wider text-transparent sm:text-4xl">
              ⚔ Kotoba Battle ⚔
            </h1>
            <button
              onClick={backToMenu}
              className="mt-1 text-xs text-slate-400 transition-colors hover:text-purple-300"
            >
              {currentMode?.emoji} {currentMode?.label} · ganti mode
            </button>
          </header>

          <section className="mb-3 flex justify-center gap-3 sm:mb-6 sm:gap-4">
            <div className="rounded-lg border border-purple-500/40 bg-slate-900/70 px-5 py-2 shadow-lg shadow-purple-900/30">
              <div className="text-xs uppercase tracking-widest text-purple-300">Wave</div>
              <div className="text-center text-2xl font-bold text-amber-300">{wave}</div>
            </div>
            <div className="rounded-lg border border-purple-500/40 bg-slate-900/70 px-5 py-2 shadow-lg shadow-purple-900/30">
              <div className="text-xs uppercase tracking-widest text-purple-300">
                Monster Kills
              </div>
              <div className="text-center text-2xl font-bold text-rose-400">{kills}</div>
            </div>
          </section>

          <section className="mb-4 grid grid-cols-2 gap-3 sm:mb-8 sm:gap-4">
            <div className="rounded-xl border border-emerald-700/40 bg-slate-900/60 p-3 backdrop-blur sm:p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="text-3xl">🧙</div>
                <div>
                  <div className="text-sm font-semibold text-emerald-300">Hero</div>
                  <div className="text-xs text-slate-400">
                    HP {playerHP}/{MAX_HP}
                  </div>
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full border border-emerald-900 bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-300"
                  style={{ width: `${playerPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-rose-700/40 bg-slate-900/60 p-3 backdrop-blur sm:p-4">
              <div className="mb-2 flex items-center justify-end gap-3">
                <div className="text-right">
                  <div className="text-sm font-semibold text-rose-300">
                    Monster Lv.{wave}
                  </div>
                  <div className="text-xs text-slate-400">
                    HP {monsterHP}/{MAX_HP}
                  </div>
                </div>
                <div className="text-3xl">👹</div>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full border border-rose-900 bg-slate-800">
                <div
                  className="ml-auto h-full bg-gradient-to-l from-rose-500 to-rose-300 transition-all duration-300"
                  style={{ width: `${monsterPct}%` }}
                />
              </div>
            </div>
          </section>

          <section className="mb-3 text-center sm:mb-6">
            <div className="mb-1 text-xs uppercase tracking-widest text-purple-300 sm:mb-2">
              Arti (Bahasa Indonesia)
            </div>
            <div className="rounded-2xl border border-purple-500/30 bg-slate-900/70 px-4 py-4 text-3xl font-bold shadow-inner sm:py-6 sm:text-5xl">
              {currentWord.meaning}
            </div>
            <div className="mt-3 min-h-7">
              {revealing && revealedWord ? (
                <div className="text-rose-400">
                  <div className="text-lg font-bold">✗ Salah!</div>
                  <div className="text-sm text-amber-300">
                    Jawaban: <span className="font-semibold">{revealKana}</span>
                    {showRevealKanji && (
                      <span className="text-slate-400"> ({revealKanji})</span>
                    )}
                  </div>
                </div>
              ) : (
                feedback.type && (
                  <div
                    className={`text-lg font-bold ${
                      feedback.type === "correct"
                        ? "text-emerald-400"
                        : feedback.type === "wrong"
                          ? "text-rose-400"
                          : "text-amber-300"
                    }`}
                  >
                    {feedback.msg}
                  </div>
                )
              )}
            </div>
          </section>

          <section className="mb-3">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>⏱ Waktu</span>
              <span className={timeLeft <= 3 ? "font-bold text-rose-400" : ""}>
                {timeLeft}s
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${
                  timeLeft <= 3 ? "bg-rose-500" : "bg-amber-400"
                }`}
                style={{ width: `${timePct}%` }}
              />
            </div>
          </section>

          <section className={shake ? "kb-shake" : ""}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              disabled={gameOver || revealing}
              placeholder="日本語で入力... (tekan Enter)"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border-2 border-purple-500/40 bg-slate-900/80 px-5 py-4 text-center text-2xl placeholder:text-base placeholder:text-slate-600 focus:border-purple-400 focus:shadow-[0_0_25px_rgba(168,85,247,0.35)] focus:outline-none disabled:opacity-50"
            />
          </section>

          <p className="mt-3 text-center text-xs text-slate-500">
            Ketik dalam <span className="text-purple-300">Kana</span> atau{" "}
            <span className="text-purple-300">Kanji</span>, lalu tekan{" "}
            <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-300">
              Enter
            </kbd>
          </p>
        </div>
      )}

      {gameOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div className="my-auto w-full max-w-md rounded-2xl border-2 border-rose-500/50 bg-gradient-to-br from-slate-900 to-purple-950 p-6 text-center shadow-2xl shadow-rose-900/50 sm:p-8">
            <div className="mb-2 text-5xl sm:text-6xl">💀</div>
            <h2 className="mb-1 text-3xl font-bold text-rose-400 sm:text-4xl">
              Game Over
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Mode: {currentMode?.emoji} {currentMode?.label}
            </p>

            <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3">
              <div className="rounded-lg border border-purple-500/30 bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase text-purple-300">Wave</div>
                <div className="text-2xl font-bold text-amber-300">
                  {wave}
                  {lastDelta?.newBestWave && (
                    <span className="ml-1 align-middle text-[10px] text-emerald-300">
                      NEW!
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-purple-500/30 bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase text-purple-300">Kills</div>
                <div className="text-2xl font-bold text-rose-400">{kills}</div>
              </div>
              <div className="rounded-lg border border-purple-500/30 bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase text-purple-300">APM</div>
                <div className="text-2xl font-bold text-cyan-300">
                  {apm.toFixed(1)}
                  {lastDelta?.newBestAPM && apm > 0 && (
                    <span className="ml-1 align-middle text-[10px] text-emerald-300">
                      NEW!
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-purple-500/30 bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase text-purple-300">Akurasi</div>
                <div className="text-2xl font-bold text-emerald-300">
                  {accuracyPct.toFixed(0)}%
                  {lastDelta?.newBestAccuracy && totalAnswered > 0 && (
                    <span className="ml-1 align-middle text-[10px] text-emerald-300">
                      NEW!
                    </span>
                  )}
                </div>
              </div>
            </div>

            {lastDelta?.previous && (
              <p className="mb-4 text-[11px] text-slate-500">
                Best sebelumnya: W{lastDelta.previous.bestWave} ·{" "}
                {lastDelta.previous.bestAPM.toFixed(1)} APM ·{" "}
                {(lastDelta.previous.bestAccuracy * 100).toFixed(0)}%
              </p>
            )}

            {wrongLog.length > 0 && (
              <div className="mb-4 rounded-lg border border-rose-500/30 bg-slate-950/60 p-3 text-left">
                <div className="mb-2 text-[10px] uppercase tracking-widest text-rose-300">
                  Kata yang perlu dilatih ({wrongLog.length})
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {wrongLog.slice(0, 30).map((w, i) => (
                    <li key={i} className="flex justify-between gap-2 text-slate-300">
                      <span className="truncate">
                        <span className="text-amber-200">{w.word.kanji}</span>
                        {w.word.kanji !== w.word.kana && (
                          <span className="text-slate-500"> ({w.word.kana})</span>
                        )}
                      </span>
                      <span className="shrink-0 text-slate-500">
                        {w.word.meaning}
                      </span>
                    </li>
                  ))}
                  {wrongLog.length > 30 && (
                    <li className="text-center text-slate-600">
                      ...dan {wrongLog.length - 30} kata lainnya
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={restartCurrentMode}
                className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 text-base font-bold shadow-lg shadow-purple-900/50 transition-all hover:from-purple-500 hover:to-pink-500 hover:shadow-purple-700/50"
              >
                ⚔ Main Lagi
              </button>
              <button
                onClick={backToMenu}
                className="w-full rounded-xl border border-purple-500/40 bg-slate-900/60 px-6 py-2.5 text-sm font-semibold text-purple-200 transition-all hover:border-purple-400 hover:bg-slate-800/60"
              >
                📚 Pilih Mode Lain
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}