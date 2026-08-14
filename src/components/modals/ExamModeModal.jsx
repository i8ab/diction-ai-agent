import { useState, useEffect, useMemo, useRef } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD, BRASS, labelStyle, primaryBtnStyle, errorStyle } from "../../lib/config/theme";
import {
  selectExamPool, buildQuiz, isTypingCorrect, quizQuestionLabel, uid,
} from "../../lib/utils/quizHelpers";
import { SpeakButton, XIcon, CheckIcon, QuizIcon, ClockIcon, FlameIcon } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";
import { loadExamDate, daysUntilExam, formatExamCountdown } from "../../lib/state/exam";

/**
 * Exam Mode — focused session on weak + due words only.
 * Modes: flash (quick review), mcq, typing, cloze.
 * Optional session countdown timer.
 */
export default function ExamModeModal({
  entries,
  studiedIds,
  studiedAt,
  srsDueAt,
  srsBox,
  isAr,
  onClose,
  onRecordSrsAnswer,
  onSaveQuizResult,
  sectionLabel = "",
  academicUnits = null,
  activeUnitId = null,
}) {
  const [stage, setStage] = useState("setup"); // setup | running | done
  const [modes, setModes] = useState(() => new Set(["mcq", "typing"])); // multi-select
  const [limit, setLimit] = useState(15);
  const [timerMin, setTimerMin] = useState(0); // 0 = off
  const [startError, setStartError] = useState("");

  // Running state
  const [pool, setPool] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("prompt"); // flash: prompt | revealed
  const [selected, setSelected] = useState(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  // Per-question answers — exam style: changeable until finish (no lock on first click)
  const [answers, setAnswers] = useState([]); // parallel to questions; null = unanswered
  const [results, setResults] = useState([]);
  const [knew, setKnew] = useState(0);
  const [learning, setLearning] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [finishedAt, setFinishedAt] = useState(null);

  // Session timer
  const [remainingMs, setRemainingMs] = useState(null);
  const endAtRef = useRef(null);

  const {
    hasUnits,
    sortedUnits,
    selectedUnitIds,
    unitFilteredEntries,
    setUnitPreset,
    toggleUnit,
    selectAllUnits,
  } = useUnitScope(academicUnits, activeUnitId, entries);

  const examDays = daysUntilExam(loadExamDate());
  const countdownLabel = formatExamCountdown(examDays, isAr);

  const examPoolPreview = useMemo(
    () => selectExamPool(unitFilteredEntries, studiedIds, srsDueAt, srsBox, studiedAt, 200),
    [unitFilteredEntries, studiedIds, srsDueAt, srsBox, studiedAt]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Countdown ticker
  useEffect(() => {
    if (stage !== "running" || !endAtRef.current) return;
    const tick = () => {
      const left = endAtRef.current - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        finishSession();
        return;
      }
      setRemainingMs(left);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [stage]);

  function toggleMode(key) {
    setModes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) return prev; // keep at least one
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function startSession() {
    const selectedPool = selectExamPool(unitFilteredEntries, studiedIds, srsDueAt, srsBox, studiedAt, limit);
    if (!selectedPool.length) {
      setStartError(tr(isAr,
        "No weak or due words yet. Study a few words first, then come back for exam practice.",
        "مفيش كلمات ضعيفة أو مستحقة للمراجعة. ذاكر شوية كلمات الأول وبعدين ارجع لوضع الامتحان."));
      return;
    }
    if (!modes.size) {
      setStartError(tr(isAr, "Pick at least one question type.", "اختار نوع أسئلة واحد على الأقل."));
      return;
    }
    setStartError("");
    setPool(selectedPool);
    setResults([]);
    setKnew(0);
    setLearning(0);
    setIndex(0);
    setSelected(null);
    setTypedAnswer("");
    setPhase("prompt");
    setStartedAt(Date.now());
    setFinishedAt(null);

    if (timerMin > 0) {
      endAtRef.current = Date.now() + timerMin * 60 * 1000;
      setRemainingMs(timerMin * 60 * 1000);
    } else {
      endAtRef.current = null;
      setRemainingMs(null);
    }

    const quizModes = [...modes].filter((m) => m !== "flash");
    const flashOnly = modes.has("flash") && quizModes.length === 0;

    if (flashOnly) {
      setQuestions([]);
      setStage("running");
      return;
    }

    // Build a mixed quiz: for each mode, build questions, then interleave.
    // Drop broken MCQ items (fewer than 2 options) so the UI never shows a one-choice screen.
    const perMode = [];
    for (const m of quizModes) {
      const built = buildQuiz(selectedPool, entries, m).filter((q) => {
        if (q.mode === "mcq" || q.type === "mcq") {
          return Array.isArray(q.options) && q.options.length >= 2;
        }
        return true;
      });
      perMode.push(built);
    }
    // Round-robin merge so types alternate
    const mixed = [];
    const usedEntry = new Set();
    let maxLen = Math.max(0, ...perMode.map((a) => a.length));
    for (let i = 0; i < maxLen; i++) {
      for (const arr of perMode) {
        if (i < arr.length) {
          const q = arr[i];
          // Prefer variety: skip if same entryId already added from another mode this round
          // but still allow if pool is small
          mixed.push(q);
        }
      }
    }
    // Cap to ~limit * modes but not crazy long
    const capped = mixed.slice(0, Math.max(limit, Math.min(mixed.length, limit * quizModes.length)));
    if (!capped.length) {
      setStartError(tr(isAr,
        "Couldn't build questions from these words.",
        "مش قادر أبني أسئلة من الكلمات دي."));
      return;
    }
    setQuestions(capped);
    setAnswers(new Array(capped.length).fill(null));
    setIndex(0);
    setSelected(null);
    setTypedAnswer("");
    setStage("running");
  }

  function finishSession() {
    if (stage === "done") return;
    const finishedTime = Date.now();
    setFinishedAt(finishedTime);
    setStage("done");
    endAtRef.current = null;
    // Build final results from answers (exam: grade only at the end)
    const finalResults = questions.map((q, i) => {
      const a = answers[i];
      if (!a) {
        return {
          id: q.id, correct: false, type: q.type,
          word: q.word, wordDir: q.wordDir, wordFont: q.wordFont, pos: q.pos || "",
          selectedAnswer: "—",
          correctAnswer: (q.correctAnswers && q.correctAnswers.length)
            ? q.correctAnswers.join(" | ") : (q.correct || ""),
        };
      }
      return a;
    });
    setResults(finalResults);
    if (onSaveQuizResult && questions.length > 0) {
      const finalScore = finalResults.filter((r) => r.correct).length;
      onSaveQuizResult({
        id: uid(),
        at: finishedTime,
        section: sectionLabel || "exam",
        mode: `exam-mixed`,
        score: finalScore,
        total: finalResults.length,
        durationMs: startedAt ? finishedTime - startedAt : 0,
      });
    }
    // Feed SRS once at the end for each answered question
    if (onRecordSrsAnswer) {
      questions.forEach((q, i) => {
        const a = answers[i];
        if (a) onRecordSrsAnswer(q.entryId, !!a.correct);
      });
    }
  }

  function saveAnswerAt(idx, opt, correct) {
    const q = questions[idx];
    if (!q) return;
    const correctLabel = (q.correctAnswers && q.correctAnswers.length)
      ? q.correctAnswers.join(" | ")
      : q.correct;
    const row = {
      id: q.id, correct, type: q.type,
      word: q.word, wordDir: q.wordDir, wordFont: q.wordFont, pos: q.pos || "",
      selectedAnswer: Array.isArray(opt) ? opt.join(" | ") : opt,
      correctAnswer: correctLabel,
      selected: opt,
      selectedList: Array.isArray(opt) ? opt : [opt],
    };
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = row;
      return next;
    });
    setSelected(opt);
  }

  function pickOption(opt) {
    // Exam style: never lock — learner can change until they finish
    const q = questions[index];
    if (!q) return;
    const need = q.selectCount || 1;
    const corrects = q.correctAnswers || [q.correct];
    if (need <= 1) {
      saveAnswerAt(index, opt, corrects.includes(opt) || opt === q.correct);
      return;
    }
    const prev = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    let nextList;
    if (prev.includes(opt)) nextList = prev.filter((x) => x !== opt);
    else if (prev.length < need) nextList = [...prev, opt];
    else {
      // at max — replace by deselecting first item then adding (or just ignore)
      nextList = [...prev.slice(1), opt];
    }
    setSelected(nextList);
    if (nextList.length === need) {
      const ok = nextList.length === need && nextList.every((x) => corrects.includes(x))
        && corrects.every((c) => nextList.includes(c));
      saveAnswerAt(index, nextList, ok);
    } else {
      // partial — clear committed answer so number strip shows unanswered
      setAnswers((old) => {
        const copy = [...old];
        copy[index] = null;
        return copy;
      });
    }
  }

  function submitTyped() {
    const q = questions[index];
    if (!q) return;
    // Empty must not count as wrong — UI already disables the button; guard for safety.
    if (!String(typedAnswer || "").trim()) return;
    const accepted = q.acceptedAnswers?.length ? q.acceptedAnswers : [q.correct];
    const isCorrect = isTypingCorrect(typedAnswer, accepted);
    saveAnswerAt(index, typedAnswer, isCorrect);
  }

  function goToQuestion(i) {
    if (i < 0 || i >= questions.length) return;
    setIndex(i);
    const a = answers[i];
    if (a) {
      const sel = a.selectedList != null ? a.selectedList
        : (a.selected != null ? a.selected : null);
      setSelected(sel);
      // Restore typed answer only for typing/cloze (not MCQ joined strings)
      const isTypingQ = a.type === "typing" || a.type === "cloze"
        || (questions[i] && (questions[i].mode === "typing" || questions[i].mode === "cloze"
          || questions[i].type === "typing" || questions[i].type === "cloze"));
      if (isTypingQ && typeof a.selectedAnswer === "string") {
        setTypedAnswer(String(a.selectedAnswer));
      } else {
        setTypedAnswer("");
      }
    } else {
      setSelected(null);
      setTypedAnswer("");
    }
    setPhase("prompt");
  }

  /** Skip = leave current unanswered and jump to next unanswered (does NOT mark wrong). */
  function skipQuestion() {
    // Clear partial multi-select draft so the question stays unanswered
    if (answers[index] && Array.isArray(selected) && (questions[index]?.selectCount || 1) > 1) {
      const need = questions[index].selectCount || 1;
      if (selected.length < need) {
        setAnswers((prev) => {
          const copy = [...prev];
          copy[index] = null;
          return copy;
        });
        setSelected(null);
      }
    }
    goToNextUnanswered();
  }

  function goToNextUnanswered() {
    let nextIdx = -1;
    for (let i = index + 1; i < questions.length; i++) {
      if (!answers[i]) { nextIdx = i; break; }
    }
    if (nextIdx === -1) {
      for (let i = 0; i < index; i++) {
        if (!answers[i]) { nextIdx = i; break; }
      }
    }
    if (nextIdx === -1) return; // no other unanswered
    goToQuestion(nextIdx);
  }

  function goToNext() {
    if (index + 1 < questions.length) {
      goToQuestion(index + 1);
    }
  }

  function nextQuestion() {
    if (index + 1 >= questions.length) {
      const unanswered = answers.findIndex((a) => !a);
      if (unanswered >= 0 && unanswered !== index) {
        goToQuestion(unanswered);
        return;
      }
      // On last question with no other unanswered: finish only if current is answered
      // otherwise stay so user can answer or use Submit when ready
      if (answers[index]) {
        finishSession();
      }
    } else {
      goToQuestion(index + 1);
    }
  }

  // Flash mode handlers
  function handleFlashKnew(ok) {
    const entry = pool[index];
    if (!entry) return;
    if (ok) setKnew((n) => n + 1);
    else setLearning((n) => n + 1);
    if (onRecordSrsAnswer) onRecordSrsAnswer(entry.id, ok);
    if (index < pool.length - 1) {
      setIndex((i) => i + 1);
      setPhase("prompt");
    } else {
      finishSession();
    }
  }

  const score = results.filter((r) => r.correct).length;
  const answeredCount = answers.filter((a) => a).length;
  const chipStyle = (active) => ({
    padding: "7px 13px", fontSize: 12.5, fontWeight: 600,
    color: active ? "#fff" : "var(--icon-muted)",
    background: active ? BRASS : "none",
    border: `1px solid ${active ? BRASS : "rgba(var(--border-rgb),0.25)"}`,
    borderRadius: 20, cursor: "pointer",
  });

  function formatTimer(ms) {
    if (ms == null) return "";
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  return (
    <div
      onClick={onClose}
      className="modal-backdrop"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "max(12px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom))",
        zIndex: 6100,
      }}
    >
      <BodyScrollLock />
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card"
        dir={isAr ? "rtl" : "ltr"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exam-mode-title"
        style={{
          width: "100%", maxWidth: 540, maxHeight: "min(92dvh, 92vh)",
          overflow: "hidden", display: "flex", flexDirection: "column",
          background: CARD, borderRadius: 12,
          padding: "22px 22px 20px",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexShrink: 0 }}>
          <h2 id="exam-mode-title" style={{
            fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: INK, margin: 0,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <FlameIcon size={19} color="#e85d04" />
            {tr(isAr, "Exam Mode", "وضع الامتحان")}
          </h2>
          <button
            onClick={onClose}
            aria-label={tr(isAr, "Close", "إغلاق")}
            style={{
              border: "none", background: "none", cursor: "pointer", color: "var(--icon-muted)",
              width: 36, height: 36, padding: 0, borderRadius: 10,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <XIcon size={20} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>


        {countdownLabel && stage === "setup" && (
          <div style={{
            marginTop: 10, padding: "10px 12px", borderRadius: 8,
            background: examDays != null && examDays <= 7 ? "var(--danger-bg)" : "var(--input-bg)",
            border: `1px solid ${examDays != null && examDays <= 7 ? "var(--danger-border)" : "rgba(var(--border-rgb),0.15)"}`,
            fontSize: 13.5, fontWeight: 600, color: examDays != null && examDays <= 7 ? "var(--danger)" : "var(--muted-strong)",
          }}>
            {countdownLabel}
            {examPoolPreview.length > 0 && (
              <span style={{ fontWeight: 500, marginInlineStart: 6 }}>
                · {tr(isAr, `${examPoolPreview.length} weak/due words`, `${examPoolPreview.length} كلمة ضعيفة/مستحقة`)}
              </span>
            )}
          </div>
        )}

        {/* ——— SETUP ——— */}
        {stage === "setup" && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 14, color: "var(--muted-strong)", margin: "0 0 14px", lineHeight: 1.5 }}>
              {tr(isAr,
                "Focused practice on words you still struggle with or that are due for review. No distractions — just the words that matter before the exam.",
                "تدريب مركّز على الكلمات اللي لسه ضعيفة أو مستحقة للمراجعة. بدون تشتيت — بس الكلمات المهمة قبل الامتحان.")}
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
              accent="#e85d04"
              accentSoft="rgba(232, 93, 4, 0.12)"
              onChange={() => setStartError("")}
            />

            <div style={{ fontSize: 13, color: "var(--muted-strong)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <QuizIcon size={14} color="var(--success)" />
              {tr(isAr,
                `${examPoolPreview.length} weak or due word${examPoolPreview.length === 1 ? "" : "s"} available`,
                `${examPoolPreview.length} كلمة ضعيفة أو مستحقة متاحة`)}
            </div>

            <label style={labelStyle}>{tr(isAr, "How many words", "عدد الكلمات")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {[10, 15, 20, 30].map((n) => (
                <button key={n} type="button" onClick={() => setLimit(n)} style={chipStyle(limit === n)}>
                  {n}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 14 }}>{tr(isAr, "Question types (pick one or more)", "أنواع الأسئلة (اختار واحد أو أكتر)")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => toggleMode("flash")} style={chipStyle(modes.has("flash"))}>
                {tr(isAr, "Quick flash", "مراجعة سريعة")}
              </button>
              <button type="button" onClick={() => toggleMode("mcq")} style={chipStyle(modes.has("mcq"))}>
                {tr(isAr, "Multiple choice", "اختيار من متعدد")}
              </button>
              <button type="button" onClick={() => toggleMode("typing")} style={chipStyle(modes.has("typing"))}>
                {tr(isAr, "Type answer", "اكتب الإجابة")}
              </button>
              <button type="button" onClick={() => toggleMode("cloze")} style={chipStyle(modes.has("cloze"))}>
                {tr(isAr, "Fill the blank", "أكمل الفراغ")}
              </button>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
              {tr(isAr,
                "Selecting more than one mixes question types in the same session.",
                "لو اخترت أكتر من نوع، الأسئلة هتتخلط في نفس الجلسة.")}
            </p>

            <label style={{ ...labelStyle, marginTop: 14 }}>{tr(isAr, "Session timer (optional)", "مؤقّت الجلسة (اختياري)")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {[0, 5, 10, 15, 20].map((n) => (
                <button key={n} type="button" onClick={() => setTimerMin(n)} style={chipStyle(timerMin === n)}>
                  {n === 0 ? tr(isAr, "Off", "إيقاف") : `${n} ${tr(isAr, "min", "د")}`}
                </button>
              ))}
            </div>

            {startError && <div style={errorStyle} role="alert">{startError}</div>}

            <button
              type="button"
              onClick={startSession}
              disabled={examPoolPreview.length === 0}
              style={{
                ...primaryBtnStyle,
                opacity: examPoolPreview.length === 0 ? 0.5 : 1,
                cursor: examPoolPreview.length === 0 ? "default" : "pointer",
                background: "linear-gradient(135deg, #e85d04, #f4a261)",
              }}
            >
              <FlameIcon size={16} /> {tr(isAr, "Start exam practice", "ابدأ تدريب الامتحان")}
            </button>
          </div>
        )}

        {/* ——— RUNNING ——— */}
        {stage === "running" && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Top bar: timer + progress + answered count */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 12, gap: 8, flexWrap: "wrap",
            }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 20,
                background: "rgba(var(--border-rgb),0.12)",
                fontSize: 13, fontWeight: 700, color: "var(--muted-strong)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {remainingMs != null ? (
                  <>
                    <ClockIcon size={13} />
                    <span style={{ color: remainingMs < 60_000 ? "var(--danger)" : undefined }}>
                      {formatTimer(remainingMs)}
                    </span>
                  </>
                ) : (
                  <span style={{ opacity: 0.7 }}>
                    {questions.length === 0
                      ? tr(isAr, `Word ${index + 1} of ${pool.length}`, `كلمة ${index + 1} من ${pool.length}`)
                      : tr(isAr, "Exam", "امتحان")}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                {questions.length === 0
                  ? `${index + 1}/${pool.length}`
                  : `${index + 1}/${questions.length}`}
              </span>
              {questions.length > 0 && (
                <span style={{ fontSize: 13, fontWeight: 700, color: BRASS }}>
                  {answeredCount}/{questions.length}
                </span>
              )}
            </div>

            {/* Progress bar — based on answered count (quiz-style) for MCQ/typing; index for flash */}
            <div style={{
              width: "100%", height: 5, background: "rgba(var(--border-rgb),0.15)",
              borderRadius: 3, marginBottom: 16, overflow: "hidden",
            }}>
              <div style={{
                width: questions.length > 0
                  ? `${(answeredCount / Math.max(questions.length, 1)) * 100}%`
                  : `${((index + (phase === "revealed" ? 1 : 0)) / Math.max(pool.length, 1)) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                borderRadius: 3,
                transition: "width 0.25s ease",
              }} />
            </div>

            {questions.length === 0 && pool[index] && (() => {
              const entry = pool[index];
              const isArWord = entry.section === "ar-ar";
              const wordDir = isArWord ? "rtl" : "ltr";
              const wordFont = isArWord ? "'Amiri', serif" : "'Fraunces', serif";
              const meaning = entry.meaning || (entry.senses && entry.senses[0]?.meaning) || "";
              return (
                <div>
                  <div style={{
                    background: "var(--input-bg)", borderRadius: 8, padding: "28px 18px",
                    textAlign: "center", marginBottom: 16,
                  }}>
                    <div dir={wordDir} style={{
                      fontFamily: wordFont, fontSize: "clamp(28px, 5vw, 36px)",
                      fontWeight: 700, color: INK, wordBreak: "break-word",
                    }}>
                      {entry.word}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <SpeakButton text={entry.word} dir={wordDir} isAr={isAr} size={20} />
                    </div>
                  </div>
                  {phase === "prompt" ? (
                    <button type="button" onClick={() => setPhase("revealed")} style={primaryBtnStyle}>
                      {tr(isAr, "Show meaning", "أظهر المعنى")}
                    </button>
                  ) : (
                    <div>
                      <div dir="rtl" style={{
                        fontFamily: "'Amiri', serif", fontSize: 20, color: INK,
                        textAlign: "center", marginBottom: 18, lineHeight: 1.5,
                      }}>
                        {meaning}
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => handleFlashKnew(true)}
                          style={{
                            flex: 1, padding: "12px 10px", borderRadius: 10, border: "none",
                            background: "var(--success-bg)", color: "var(--success)",
                            fontWeight: 700, fontSize: 14, cursor: "pointer",
                          }}
                        >
                          <CheckIcon size={15} /> {tr(isAr, "I knew it", "عرفتها")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFlashKnew(false)}
                          style={{
                            flex: 1, padding: "12px 10px", borderRadius: 10, border: "none",
                            background: "var(--danger-bg)", color: "var(--danger)",
                            fontWeight: 700, fontSize: 14, cursor: "pointer",
                          }}
                        >
                          <XIcon size={15} /> {tr(isAr, "Still learning", "لسه بتعلمها")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {questions.length > 0 && questions[index] && (() => {
              const q = questions[index];
              const isMulti = !!q.multi || (q.selectCount || 1) > 1;
              const total = questions.length;
              const hasAnswer = !!answers[index];
              const allAnswered = total > 0 && answeredCount === total;
              const selectedList = Array.isArray(selected)
                ? selected
                : (selected ? [selected] : []);
              // Number strip window around current (same as quiz)
              const windowSize = 9;
              let startNum = Math.max(1, (index + 1) - Math.floor(windowSize / 2));
              let endNum = Math.min(total, startNum + windowSize - 1);
              if (endNum - startNum + 1 < windowSize) startNum = Math.max(1, endNum - windowSize + 1);
              const numberStrip = [];
              for (let n = startNum; n <= endNum; n++) numberStrip.push(n);

              const letters = isAr
                ? ["أ", "ب", "ج", "د", "هـ"]
                : ["A", "B", "C", "D", "E"];

              return (
                <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                  {/* Question type label */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <p style={{
                      fontSize: 13, fontWeight: 700, color: "var(--muted-strong)", margin: 0,
                      letterSpacing: "0.02em", textTransform: "uppercase",
                    }}>
                      {quizQuestionLabel(
                        (q.mode === "typing" || q.mode === "cloze") ? q.mode : (q.type || q.mode),
                        isAr,
                        q.pos,
                        isMulti
                      )}
                    </p>
                  </div>
                  {isMulti && (
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
                      {tr(isAr, `Select ${q.selectCount || 2} answers`, `اختار ${(q.selectCount || 2)} إجابات`)}
                      {selectedList.length > 0 ? ` · ${selectedList.length}/${q.selectCount || 2}` : ""}
                    </p>
                  )}

                  {/* Prompt card */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    background: "var(--input-bg)",
                    borderRadius: 16,
                    padding: "18px 16px",
                    marginBottom: 18,
                    border: "1px solid rgba(var(--border-rgb),0.12)",
                    boxShadow: "0 4px 16px -8px rgba(0,0,0,0.15)",
                  }}>
                    <div dir={q.promptDir} style={{
                      flex: 1, minWidth: 0, fontFamily: q.promptFont,
                      fontSize: (q.mode === "cloze" || q.type === "cloze")
                        ? "clamp(18px, 3.5vw, 24px)"
                        : "clamp(22px, 4vw, 30px)",
                      fontWeight: 700, color: INK, wordBreak: "break-word", lineHeight: 1.35,
                    }}>
                      {q.promptText}
                    </div>
                    {q.promptText && q.mode !== "cloze" && q.type !== "cloze" && (
                      <SpeakButton
                        text={q.word || q.promptText}
                        dir={q.wordDir || q.promptDir}
                        isAr={isAr}
                        size={20}
                        style={{
                          flexShrink: 0,
                          background: "var(--card)",
                          border: "1px solid rgba(var(--border-rgb),0.2)",
                          borderRadius: "50%",
                          width: 40, height: 40,
                          justifyContent: "center",
                          color: BRASS,
                        }}
                      />
                    )}
                  </div>

                  {/* Options / typing
                      Important: use mode, not type. Typing questions also have type "meaning"
                      but only one "option" (the answer) — showing them as MCQ looked like a
                      broken one-choice question. */}
                  {(q.mode === "mcq" || q.type === "mcq") ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      {(q.options || []).map((opt, i) => {
                        const isSelectedOpt = selectedList.includes(opt);
                        // Exam: never reveal correct/wrong while running — only mark selected
                        let bg = "var(--card)";
                        let border = "rgba(var(--border-rgb),0.18)";
                        let color = INK;
                        let letterBg = "rgba(var(--border-rgb),0.12)";
                        let letterColor = "var(--muted-strong)";
                        if (isSelectedOpt) {
                          bg = "var(--accent-1-soft)";
                          border = "var(--accent-1)";
                          letterBg = "var(--accent-1)";
                          letterColor = "#fff";
                        }
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => pickOption(opt)}
                            dir={q.optionDir}
                            style={{
                              textAlign: "start",
                              fontFamily: q.optionFont,
                              fontSize: 15.5,
                              padding: "14px 14px",
                              background: bg,
                              border: `1.5px solid ${border}`,
                              color,
                              borderRadius: 14,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              minHeight: 52,
                              boxShadow: "0 2px 8px -4px rgba(0,0,0,0.12)",
                              transition: "transform 0.12s ease, box-shadow 0.12s ease",
                            }}
                          >
                            <span style={{
                              flexShrink: 0, width: 32, height: 32, borderRadius: 10,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 14, fontWeight: 800, background: letterBg, color: letterColor,
                              fontFamily: "'Source Sans 3', sans-serif",
                            }}>
                              {letters[i] || (i + 1)}
                            </span>
                            <span style={{ flex: 1, lineHeight: 1.35 }}>{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ marginBottom: 16 }}>
                      <input
                        type="text"
                        dir={q.optionDir}
                        autoFocus
                        value={typedAnswer}
                        onChange={(e) => setTypedAnswer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (typedAnswer.trim()) submitTyped();
                          }
                        }}
                        placeholder={(q.mode === "cloze" || q.type === "cloze")
                          ? tr(isAr, "Type the missing word…", "اكتب الكلمة الناقصة…")
                          : tr(isAr, "Type your answer…", "اكتب إجابتك…")}
                        style={{
                          width: "100%", boxSizing: "border-box", padding: "12px 14px",
                          fontFamily: q.optionFont, fontSize: 16, color: INK,
                          background: "var(--input-bg)",
                          border: "1px solid rgba(var(--border-rgb),0.2)",
                          borderRadius: 12,
                          marginBottom: 10,
                        }}
                      />
                      <button
                        type="button"
                        onClick={submitTyped}
                        disabled={!typedAnswer.trim()}
                        style={{
                          ...primaryBtnStyle,
                          marginTop: 0,
                          opacity: typedAnswer.trim() ? 1 : 0.5,
                          cursor: typedAnswer.trim() ? "pointer" : "default",
                        }}
                      >
                        {tr(isAr, hasAnswer ? "Update answer" : "Save answer", hasAnswer ? "تعديل الإجابة" : "حفظ الإجابة")}
                      </button>
                    </div>
                  )}

                  {/* Bottom: number strip + actions (quiz-style) */}
                  <div style={{ marginTop: "auto", paddingTop: 8 }}>
                    <div style={{
                      display: "flex", justifyContent: "center", alignItems: "center",
                      gap: 6, marginBottom: 14, flexWrap: "wrap",
                    }}>
                      {numberStrip.map((n) => {
                        const i = n - 1;
                        const isCurrent = i === index;
                        const isDone = !!answers[i];
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => goToQuestion(i)}
                            style={{
                              width: isCurrent ? 36 : 28,
                              height: isCurrent ? 36 : 28,
                              borderRadius: 10,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: isCurrent ? 14 : 12,
                              fontWeight: isCurrent ? 800 : 600,
                              background: isCurrent
                                ? "linear-gradient(135deg, var(--accent-1), var(--accent-2))"
                                : isDone
                                  ? "var(--accent-1-soft)"
                                  : "transparent",
                              color: isCurrent
                                ? "#fff"
                                : isDone
                                  ? "var(--accent-1)"
                                  : "var(--muted-strong)",
                              border: isCurrent
                                ? "none"
                                : isDone
                                  ? "1.5px solid var(--accent-1)"
                                  : "1px solid rgba(var(--border-rgb),0.15)",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                              padding: 0,
                            }}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>

                    {/* Actions — same logic as quiz */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {!hasAnswer ? (
                        <button
                          type="button"
                          onClick={skipQuestion}
                          style={{
                            flex: 1,
                            padding: "13px 16px",
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#fff",
                            background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                            border: "none",
                            borderRadius: 14,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            minHeight: 50,
                            boxShadow: "0 8px 20px -10px rgba(var(--focus-rgb),0.55)",
                          }}
                        >
                          {tr(isAr, "Skip", "تخطي")} ▶
                        </button>
                      ) : (
                        <>
                          {index + 1 < total && (
                            <button
                              type="button"
                              onClick={goToNext}
                              style={{
                                flex: 1,
                                padding: "13px 16px",
                                fontSize: 15,
                                fontWeight: 700,
                                color: "#fff",
                                background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                                border: "none",
                                borderRadius: 14,
                                cursor: "pointer",
                                minHeight: 50,
                              }}
                            >
                              {tr(isAr, "Next", "التالي")} ▶
                            </button>
                          )}
                          {allAnswered && (
                            <button
                              type="button"
                              onClick={finishSession}
                              style={{
                                flex: 1,
                                ...primaryBtnStyle,
                                marginTop: 0,
                                borderRadius: 14,
                                minHeight: 50,
                                background: "var(--success)",
                                borderColor: "var(--success)",
                              }}
                            >
                              <CheckIcon size={16} /> {tr(isAr, "Submit exam", "تسليم الامتحان")}
                            </button>
                          )}
                          {!allAnswered && index + 1 >= total && (
                            <button
                              type="button"
                              onClick={goToNextUnanswered}
                              style={{
                                flex: 1,
                                padding: "13px 16px",
                                fontSize: 14,
                                fontWeight: 600,
                                color: "var(--muted-strong)",
                                background: "rgba(var(--border-rgb),0.1)",
                                border: "1px solid rgba(var(--border-rgb),0.15)",
                                borderRadius: 14,
                                cursor: "pointer",
                                minHeight: 50,
                              }}
                            >
                              {tr(isAr,
                                `Go to unanswered (${answeredCount}/${total})`,
                                `روح للأسئلة الناقصة (${answeredCount}/${total})`)}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
                      {tr(isAr,
                        "Exam mode: change any answer anytime. Results are revealed only when you finish.",
                        "وضع الامتحان: غيّر أي إجابة في أي وقت. النتيجة تظهر بعد ما تخلّص بس.")}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ——— DONE ——— */}
        {stage === "done" && (() => {
          const mistakes = results.filter((r) => !r.correct);
          const pct = results.length ? Math.round((score / results.length) * 100) : 0;
          return (
            <div style={{ marginTop: 14 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 6 }}>🎯</div>
                <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "0 0 6px", color: INK }}>
                  {tr(isAr, "Session complete", "انتهت الجلسة")}
                </h3>
                {questions.length === 0 ? (
                  <p style={{ fontSize: 15, color: "var(--muted-strong)", margin: "0 0 16px" }}>
                    {tr(isAr,
                      `Knew ${knew} · Still learning ${learning}`,
                      `عرفت ${knew} · لسه بتعلّم ${learning}`)}
                  </p>
                ) : (
                  <>
                    <p style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: INK, margin: "4px 0" }}>
                      {score} / {results.length}
                    </p>
                    <p style={{ fontSize: 14, color: "var(--muted-strong)", margin: "0 0 14px" }}>
                      {tr(isAr,
                        `You got ${score} out of ${results.length} right (${pct}%).`,
                        `أجبت صح على ${score} من ${results.length} (${pct}%).`)}
                    </p>
                  </>
                )}
              </div>

              {questions.length > 0 && (
                mistakes.length > 0 ? (
                  <div style={{ textAlign: "start", marginBottom: 12, maxHeight: "42vh", overflowY: "auto" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: INK, margin: "0 0 10px" }}>
                      {tr(isAr, "Mistakes — review these", "الأخطاء — راجع دول")}
                    </p>
                    {mistakes.map((item, mi) => (
                      <div
                        key={item.id || mi}
                        style={{
                          padding: "12px 14px",
                          border: "1px solid rgba(var(--border-rgb),0.15)",
                          borderRadius: 12,
                          marginBottom: 8,
                          background: "var(--input-bg)",
                        }}
                      >
                        <div
                          dir={item.wordDir || "ltr"}
                          style={{
                            fontFamily: item.wordFont || "inherit",
                            fontSize: 16,
                            fontWeight: 700,
                            color: INK,
                            marginBottom: 6,
                          }}
                        >
                          {item.word || "—"}
                          {item.pos ? (
                            <span style={{
                              marginInlineStart: 8, fontSize: 11, fontWeight: 700,
                              color: "var(--muted-strong)", fontFamily: "'Source Sans 3', sans-serif",
                            }}>
                              ({item.pos})
                            </span>
                          ) : null}
                        </div>
                        <p style={{ fontSize: 13, color: "var(--danger)", margin: "0 0 4px", fontWeight: 600 }}>
                          {tr(isAr,
                            `Your answer: ${item.selectedAnswer || "—"}`,
                            `إجابتك: ${item.selectedAnswer || "—"}`)}
                        </p>
                        <p style={{ fontSize: 13, color: "#1a7f37", margin: 0, fontWeight: 600 }}>
                          {tr(isAr,
                            `Correct: ${item.correctAnswer || "—"}`,
                            `الصح: ${item.correctAnswer || "—"}`)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ textAlign: "center", fontSize: 14, color: "var(--success, #1a7f37)", margin: "0 0 16px", fontWeight: 600 }}>
                    {tr(isAr, "Perfect score — nothing to review!", "علامة كاملة — مفيش حاجة للمراجعة!")}
                  </p>
                )
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={() => { setStage("setup"); setStartError(""); }}
                  style={{ ...primaryBtnStyle, marginTop: 0, width: "auto", padding: "11px 20px" }}>
                  {tr(isAr, "Practice again", "تدريب تاني")}
                </button>
                <button type="button" onClick={onClose}
                  style={{
                    marginTop: 0, padding: "11px 20px", borderRadius: 12, border: "1px solid rgba(var(--border-rgb),0.25)",
                    background: "none", color: "var(--muted-strong)", fontWeight: 600, fontSize: 14, cursor: "pointer",
                  }}>
                  {tr(isAr, "Close", "إغلاق")}
                </button>
              </div>
            </div>
          );
        })()}
        </div>
      </div>
    </div>
  );
}
