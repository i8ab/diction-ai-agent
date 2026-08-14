import { useState, useEffect, useMemo } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD, BRASS, labelStyle, inputStyle, primaryBtnStyle, errorStyle } from "../../lib/config/theme";
import { speakWord } from "../../lib/utils/speech";
import { isTypingCorrect, uid } from "../../lib/utils/quizHelpers";
import { SpeakButton, XIcon, CheckIcon, EyeIcon, MicIcon } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";
import NumberStepper from "../common/NumberStepper";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Listening / Dictation mode:
 * - Play word (TTS) → user types meaning, OR
 * - Show meaning → user types the word
 */
export default function DictationModal({
  entries,
  studiedIds,
  isAr,
  onClose,
  onRecordSrsAnswer,
  onFinishRound,
  academicUnits = null,
  activeUnitId = null,
}) {
  const [mode, setMode] = useState("listen-meaning"); // listen-meaning | type-word | listen-loop
  const [count, setCount] = useState(8);
  const [loopReps, setLoopReps] = useState(3); // for listen-loop mode
  const [stage, setStage] = useState("setup"); // setup | running | done
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [loopPlayCount, setLoopPlayCount] = useState(0);
  const [loopPlaying, setLoopPlaying] = useState(false);

  const {
    hasUnits,
    sortedUnits,
    selectedUnitIds,
    unitFilteredEntries,
    setUnitPreset,
    toggleUnit,
    selectAllUnits,
  } = useUnitScope(academicUnits, activeUnitId, entries);

  const studiedSet = useMemo(
    () => (studiedIds instanceof Set ? studiedIds : new Set(studiedIds || [])),
    [studiedIds]
  );

  const pool = useMemo(
    () => (unitFilteredEntries || []).filter((e) => studiedSet.has(e.id) && e.word && e.meaning),
    [unitFilteredEntries, studiedSet]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function start() {
    if (pool.length < 1) {
      setError(
        tr(
          isAr,
          "Study some words first, then come back for dictation.",
          "اتعلّم كام كلمة الأول، وبعدين ارجع للإملاء."
        )
      );
      return;
    }
    setError("");
    const q = shuffle(pool).slice(0, Math.min(count, pool.length));
    setQueue(q);
    setIndex(0);
    setTyped("");
    setRevealed(false);
    setAnswered(false);
    setResults([]);
    setLoopPlayCount(0);
    setLoopPlaying(false);
    setStage("running");
    // auto-speak first item in listen modes
    if ((mode === "listen-meaning" || mode === "listen-loop") && q[0]) {
      setTimeout(() => speakWord(q[0].word, q[0].section === "ar-ar" ? "rtl" : "ltr"), 300);
      if (mode === "listen-loop") setLoopPlayCount(1);
    }
  }

  function playLoopOnce() {
    if (!current) return;
    setLoopPlaying(true);
    speakWord(current.word, current.section === "ar-ar" ? "rtl" : "ltr");
    setLoopPlayCount((c) => c + 1);
    setTimeout(() => setLoopPlaying(false), 800);
  }

  const current = queue[index];

  function check() {
    if (!current || answered) return;
    // Empty answer must NOT count as wrong — ask the user to type first.
    if (!String(typed || "").trim()) {
      setError(
        tr(
          isAr,
          "Type your answer first.",
          "اكتب الإجابة أولاً."
        )
      );
      return;
    }
    setError("");
    // listen-meaning → type meaning; type-word & listen-loop → type the word
    const expected = mode === "listen-meaning" ? current.meaning : current.word;
    const ok = isTypingCorrect(typed, expected);
    setCorrect(ok);
    setAnswered(true);
    setResults((r) => [...r, { id: current.id, word: current.word, meaning: current.meaning, ok, typed }]);
    if (onRecordSrsAnswer) onRecordSrsAnswer(current.id, ok);
  }

  function next() {
    if (index + 1 >= queue.length) {
      setStage("done");
      if (onFinishRound) onFinishRound(results.length + (answered ? 0 : 0));
      return;
    }
    const nextIdx = index + 1;
    setIndex(nextIdx);
    setTyped("");
    setRevealed(false);
    setAnswered(false);
    setCorrect(false);
    setError("");
    setLoopPlayCount(0);
    setLoopPlaying(false);
    if ((mode === "listen-meaning" || mode === "listen-loop") && queue[nextIdx]) {
      setTimeout(
        () => speakWord(queue[nextIdx].word, queue[nextIdx].section === "ar-ar" ? "rtl" : "ltr"),
        200
      );
      if (mode === "listen-loop") setLoopPlayCount(1);
    }
  }

  const score = results.filter((r) => r.ok).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "12px 12px max(12px, env(safe-area-inset-bottom))",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <BodyScrollLock />
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "92dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: CARD,
          borderRadius: 16,
          padding: "20px 18px 24px",
          boxShadow: "0 20px 50px -12px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: INK }}>
            {tr(isAr, "Listening & Dictation", "استماع وإملاء")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr(isAr, "Close", "إغلاق")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", width: 36, height: 36, padding: 0, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 0 }}
          >
            <XIcon size={20} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>


        {stage === "setup" && (
          <>
            <p style={{ fontSize: 13.5, color: "var(--muted-strong)", margin: "0 0 14px" }}>
              {tr(
                isAr,
                "Hear the word and type its meaning, see the meaning and type the word, or use the listening loop.",
                "اسمع الكلمة واكتب معناها، أو شوف المعنى واكتب الكلمة، أو استخدم حلقة الاستماع."
              )}
            </p>
            <UnitScopePicker
              isAr={isAr}
              hasUnits={hasUnits}
              sortedUnits={sortedUnits}
              selectedUnitIds={selectedUnitIds}
              entries={entries}
              setUnitPreset={setUnitPreset}
              toggleUnit={toggleUnit}
              selectAllUnits={selectAllUnits}
              onChange={() => setError("")}
            />
            <label style={labelStyle}>{tr(isAr, "Mode", "الوضع")}</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { id: "listen-meaning", en: "Hear word → type meaning", ar: "اسمع الكلمة → اكتب المعنى" },
                { id: "type-word", en: "See meaning → type word", ar: "شوف المعنى → اكتب الكلمة" },
                { id: "listen-loop", en: "Listening loop → type word", ar: "حلقة استماع → اكتب الكلمة" },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
                    flex: 1,
                    minWidth: 140,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: mode === m.id ? `2px solid ${BRASS}` : "1px solid rgba(var(--border-rgb),0.2)",
                    background: mode === m.id ? "var(--accent-1-soft)" : "var(--input-bg)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    color: INK,
                  }}
                >
                  {tr(isAr, m.en, m.ar)}
                </button>
              ))}
            </div>
            {mode === "listen-loop" && (
              <>
                <label style={labelStyle}>{tr(isAr, "Repeats per word", "مرات التكرار لكل كلمة")}</label>
                <NumberStepper value={loopReps} min={2} max={6} onChange={setLoopReps} />
              </>
            )}
            <label style={labelStyle}>{tr(isAr, "Number of words", "عدد الكلمات")}</label>
            <NumberStepper value={count} min={3} max={30} onChange={setCount} />
            {error && <div style={errorStyle}>{error}</div>}
            <button type="button" onClick={start} style={primaryBtnStyle}>
              {tr(isAr, "Start", "ابدأ")}
            </button>
          </>
        )}

        {stage === "running" && current && (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {index + 1} / {queue.length}
            </div>
            {mode === "listen-meaning" ? (
              <div style={{ textAlign: "center", padding: "18px 8px" }}>
                <SpeakButton
                  text={current.word}
                  dir={current.section === "ar-ar" ? "rtl" : "ltr"}
                  isAr={isAr}
                  size={36}
                  style={{ color: BRASS }}
                />
                <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted-strong)" }}>
                  {tr(isAr, "Tap the speaker, then type the meaning", "اضغط السماعة، وبعدين اكتب المعنى")}
                </p>
                {revealed && (
                  <div
                    dir={current.section === "ar-ar" ? "rtl" : "ltr"}
                    style={{
                      marginTop: 12,
                      fontFamily: current.section === "ar-ar" ? "'Amiri', serif" : "'Fraunces', serif",
                      fontSize: 22,
                      fontWeight: 700,
                      color: INK,
                    }}
                  >
                    {current.word}
                  </div>
                )}
              </div>
            ) : mode === "listen-loop" ? (
              <div style={{ textAlign: "center", padding: "18px 8px" }}>
                <div style={{ fontSize: 36, marginBottom: 6 }}>{loopPlaying ? "🔊" : "🎧"}</div>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted-strong)" }}>
                  {tr(isAr, `Played ${Math.min(loopPlayCount, loopReps)} / ${loopReps} — then type the word`, `اتشغّل ${Math.min(loopPlayCount, loopReps)} / ${loopReps} — بعدين اكتب الكلمة`)}
                </p>
                <button
                  type="button"
                  onClick={playLoopOnce}
                  style={{
                    padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(var(--border-rgb),0.25)",
                    background: "var(--input-bg)", color: INK, fontWeight: 600, fontSize: 13, cursor: "pointer",
                  }}
                >
                  {tr(isAr, "Play again", "شغّل تاني")}
                </button>
                {revealed && (
                  <div
                    dir={current.section === "ar-ar" ? "rtl" : "ltr"}
                    style={{
                      marginTop: 12,
                      fontFamily: current.section === "ar-ar" ? "'Amiri', serif" : "'Fraunces', serif",
                      fontSize: 22,
                      fontWeight: 700,
                      color: INK,
                    }}
                  >
                    {current.word}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "18px 8px" }}>
                <div dir="rtl" style={{ fontFamily: "'Amiri', serif", fontSize: 22, fontWeight: 700, color: INK }}>
                  {current.meaning}
                </div>
                <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted-strong)" }}>
                  {tr(isAr, "Type the word you hear in your head", "اكتب الكلمة")}
                </p>
              </div>
            )}

            <input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!answered) check();
                  else next();
                }
              }}
              disabled={answered}
              placeholder={
                mode === "listen-meaning"
                  ? tr(isAr, "Type the meaning…", "اكتب المعنى…")
                  : tr(isAr, "Type the word…", "اكتب الكلمة…")
              }
              dir={mode === "listen-meaning" ? "rtl" : current.section === "ar-ar" ? "rtl" : "ltr"}
              style={{ ...inputStyle, marginTop: 8, fontSize: 16 }}
              autoFocus
            />

            {error && stage === "running" && !answered && (
              <div style={{ ...errorStyle, marginTop: 10 }} role="alert" aria-live="assertive">
                {error}
              </div>
            )}

            {answered && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: correct ? "rgba(48,209,88,0.12)" : "var(--danger-bg)",
                  color: correct ? "#1a7f37" : "var(--danger)",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {correct
                  ? tr(isAr, "Correct!", "صح!")
                  : tr(
                      isAr,
                      `Not quite — answer: ${mode === "listen-meaning" ? current.meaning : current.word}`,
                      `غلط — الإجابة: ${mode === "listen-meaning" ? current.meaning : current.word}`
                    )}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              {!answered && mode === "listen-meaning" && (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  style={{
                    flex: 1,
                    padding: "11px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(var(--border-rgb),0.2)",
                    background: "var(--input-bg)",
                    cursor: "pointer",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <EyeIcon size={16} /> {tr(isAr, "Reveal word", "أظهر الكلمة")}
                </button>
              )}
              {!answered ? (
                <button type="button" onClick={check} style={{ ...primaryBtnStyle, marginTop: 0, flex: 1 }}>
                  <CheckIcon size={16} /> {tr(isAr, "Check", "تحقق")}
                </button>
              ) : (
                <button type="button" onClick={next} style={{ ...primaryBtnStyle, marginTop: 0, flex: 1 }}>
                  {index + 1 >= queue.length
                    ? tr(isAr, "Finish", "إنهاء")
                    : tr(isAr, "Next", "التالي")}
                </button>
              )}
            </div>
          </>
        )}

        {stage === "done" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎧</div>
            <h3 style={{ margin: "0 0 6px", color: INK }}>
              {tr(isAr, "Round complete", "انتهت الجولة")}
            </h3>
            <p style={{ color: "var(--muted-strong)", margin: "0 0 16px" }}>
              {score} / {results.length} {tr(isAr, "correct", "صح")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setStage("setup")}
                style={{ ...primaryBtnStyle, marginTop: 0, minHeight: 48 }}
              >
                {tr(isAr, "Another round", "جولة تانية")}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: 10,
                  border: "1px solid rgba(var(--border-rgb),0.2)",
                  background: "transparent",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: INK,
                  minHeight: 44,
                }}
              >
                {tr(isAr, "Close", "إغلاق")}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
