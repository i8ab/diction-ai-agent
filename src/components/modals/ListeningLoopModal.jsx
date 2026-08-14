import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD } from "../../lib/config/theme";
import { isSrsDue, srsLevelFromStats, shuffleArray } from "../../lib/utils/quizHelpers";
import { playCambridgeAudio, speakWord } from "../../lib/utils/speech";
import { XIcon, SpeakButton } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { SECTIONS } from "../../lib/config/sections";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";

/**
 * Listening Loop — focused audio repetition practice.
 * Plays the word (and optionally example) multiple times with pause,
 * then asks the user to type what they heard or just mark as heard.
 */
export default function ListeningLoopModal({
  entries,
  studiedIds,
  srsStats = {},
  srsDueAt = {},
  isAr,
  onClose,
  onRecordSrsAnswer,
  limit = 10,
  academicUnits = null,
  activeUnitId = null,
}) {
  const {
    hasUnits,
    sortedUnits,
    selectedUnitIds,
    unitFilteredEntries,
    setUnitPreset,
    toggleUnit,
    selectAllUnits,
  } = useUnitScope(academicUnits, activeUnitId, entries);

  const list = useMemo(() => {
    const base = (unitFilteredEntries || []).filter((e) => studiedIds.has(e.id));
    // Prefer due + weaker words
    const scored = base.map((e) => {
      const stats = srsStats[e.id] || { correct: 0, total: 0 };
      const level = srsLevelFromStats(stats);
      const due = isSrsDue(e.id, srsDueAt) ? 0 : 1;
      return { e, score: due * 10 + level };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.map((x) => x.e).slice(0, limit);
  }, [unitFilteredEntries, studiedIds, srsStats, srsDueAt, limit]);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("listen"); // listen | type | result | done
  const [reps, setReps] = useState(0);
  const [targetReps, setTargetReps] = useState(3);
  const [userInput, setUserInput] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [playing, setPlaying] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  const entry = list[idx];
  const cfg = entry ? SECTIONS[entry.section] || SECTIONS["en-ar"] : null;
  const word = entry?.word || entry?.term || "";
  const total = list.length;

  const playOnce = useCallback(async () => {
    if (!word) return;
    setPlaying(true);
    try {
      const ok = await playCambridgeAudio(word, null);
      if (!ok) {
        speakWord(word, cfg?.wordDir || "ltr");
      }
    } catch (_) {}
    setPlaying(false);
  }, [word, cfg]);

  // Auto-repeat loop
  useEffect(() => {
    if (phase !== "listen" || !autoPlay || !entry) return;
    let cancelled = false;
    let count = 0;

    async function loop() {
      while (!cancelled && count < targetReps) {
        await playOnce();
        count += 1;
        setReps(count);
        if (count < targetReps) {
          await new Promise((r) => {
            timerRef.current = setTimeout(r, 1200);
          });
        }
      }
      if (!cancelled) {
        setPhase("type");
        setTimeout(() => inputRef.current?.focus(), 80);
      }
    }
    loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, autoPlay, entry, targetReps, playOnce]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function normalize(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\s+/g, " ");
  }

  function checkAnswer() {
    const ok = normalize(userInput) === normalize(word);
    if (ok) setCorrectCount((c) => c + 1);
    else setWrongCount((c) => c + 1);
    try {
      if (typeof onRecordSrsAnswer === "function") onRecordSrsAnswer(entry.id, ok);
    } catch (_) {}
    setPhase("result");
  }

  function next() {
    if (idx < total - 1) {
      setIdx((i) => i + 1);
      setReps(0);
      setUserInput("");
      setPhase("listen");
    } else {
      setPhase("done");
    }
  }

  function skipToType() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase("type");
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  if (total === 0) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed", inset: 0, zIndex: 6000, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <BodyScrollLock />
        <div style={{ width: "100%", maxWidth: 400, background: CARD, borderRadius: 18, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎧</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
            {tr(isAr, "No words to practice", "ما فيش كلمات للتدريب")}
          </div>
          <button type="button" onClick={onClose} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 12, border: "none", background: "var(--accent-1)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {tr(isAr, "Close", "إغلاق")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr(isAr, "Listening Loop", "حلقة الاستماع")}
      style={{
        position: "fixed", inset: 0, zIndex: 6000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <BodyScrollLock />
      <div
        style={{
          width: "100%", maxWidth: 440, background: CARD,
          borderRadius: 18, padding: "20px 18px 18px",
          border: "1px solid rgba(var(--border-rgb),0.14)",
          boxShadow: "0 24px 56px -16px rgba(0,0,0,0.45)",
          maxHeight: "min(90dvh, 640px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 700, color: "var(--muted-strong)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {tr(isAr, "Listening Loop", "حلقة الاستماع")}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {phase === "done" ? tr(isAr, "Finished", "انتهى") : `${idx + 1} / ${total}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr(isAr, "Close", "إغلاق")}
            style={{
              width: 36, height: 36, borderRadius: 10, border: "none",
              background: "rgba(var(--border-rgb),0.1)", color: INK, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        <UnitScopePicker
          isAr={isAr}
          hasUnits={hasUnits}
          sortedUnits={sortedUnits}
          selectedUnitIds={selectedUnitIds}
          entries={entries}
          setUnitPreset={setUnitPreset}
          toggleUnit={toggleUnit}
          selectAllUnits={selectAllUnits}
          onChange={() => { setIdx(0); setPhase("listen"); setReps(0); setUserInput(""); setCorrectCount(0); setWrongCount(0); }}
        />

        {phase === "done" ? (
          <div style={{ padding: "28px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🎧</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK, marginBottom: 8 }}>
              {tr(isAr, "Great listening!", "استماع ممتاز!")}
            </div>
            <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
              {tr(isAr, `Correct: ${correctCount} · Missed: ${wrongCount}`, `صح: ${correctCount} · غلط: ${wrongCount}`)}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 20px", borderRadius: 12, border: "none",
                background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}
            >
              {tr(isAr, "Done", "تم")}
            </button>
          </div>
        ) : (
          <>
            {/* Settings row */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {[2, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTargetReps(n)}
                  disabled={phase !== "listen"}
                  style={{
                    padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: targetReps === n ? "none" : "1px solid rgba(var(--border-rgb),0.25)",
                    background: targetReps === n ? "var(--accent-1)" : "transparent",
                    color: targetReps === n ? "#fff" : INK,
                  }}
                >
                  {n}×
                </button>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginLeft: "auto", cursor: "pointer" }}>
                <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
                {tr(isAr, "Auto", "تلقائي")}
              </label>
            </div>

            {/* Main area */}
            <div
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "20px 8px", minHeight: 160,
                background: "rgba(var(--border-rgb),0.04)", borderRadius: 14, marginBottom: 14,
              }}
            >
              {phase === "listen" && (
                <>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>{playing ? "🔊" : "🎧"}</div>
                  <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>
                    {tr(isAr, `Playing ${reps} / ${targetReps}`, `تشغيل ${reps} / ${targetReps}`)}
                  </div>
                  <button
                    type="button"
                    onClick={playOnce}
                    style={{
                      padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(var(--border-rgb),0.25)",
                      background: "transparent", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}
                  >
                    {tr(isAr, "Play again", "شغّل تاني")}
                  </button>
                  <button
                    type="button"
                    onClick={skipToType}
                    style={{ marginTop: 10, fontSize: 12, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                  >
                    {tr(isAr, "Skip to typing", "تخطي للكتابة")}
                  </button>
                </>
              )}

              {phase === "type" && (
                <>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
                    {tr(isAr, "Type what you heard", "اكتب اللي سمعته")}
                  </div>
                  <input
                    ref={inputRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") checkAnswer(); }}
                    placeholder={tr(isAr, "Type the word…", "اكتب الكلمة…")}
                    style={{
                      width: "100%", maxWidth: 280, padding: "12px 14px", borderRadius: 12,
                      border: "1px solid rgba(var(--border-rgb),0.25)", background: "var(--input-bg)",
                      fontSize: 18, textAlign: "center", color: INK, outline: "none",
                    }}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={playOnce}
                      style={{
                        padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(var(--border-rgb),0.25)",
                        background: "transparent", color: INK, fontWeight: 600, fontSize: 13, cursor: "pointer",
                      }}
                    >
                      🔊
                    </button>
                    <button
                      type="button"
                      onClick={checkAnswer}
                      style={{
                        padding: "10px 20px", borderRadius: 12, border: "none",
                        background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                        color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
                      }}
                    >
                      {tr(isAr, "Check", "تحقق")}
                    </button>
                  </div>
                </>
              )}

              {phase === "result" && (
                <>
                  <div style={{ fontSize: 42, marginBottom: 8 }}>
                    {normalize(userInput) === normalize(word) ? "✅" : "❌"}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginBottom: 4 }}>
                    {word}
                  </div>
                  {entry?.meaning || entry?.translation ? (
                    <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>
                      {entry.meaning || entry.translation}
                    </div>
                  ) : null}
                  {normalize(userInput) !== normalize(word) && userInput && (
                    <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 8 }}>
                      {tr(isAr, `You wrote: ${userInput}`, `كتبت: ${userInput}`)}
                    </div>
                  )}
                  <SpeakButton text={word} dir={cfg?.wordDir || "ltr"} isAr={isAr} size={22} />
                </>
              )}
            </div>

            {phase === "result" && (
              <button
                type="button"
                onClick={next}
                style={{
                  width: "100%", padding: "13px 16px", borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                  color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
                }}
              >
                {idx < total - 1 ? tr(isAr, "Next", "التالي") : tr(isAr, "Finish", "إنهاء")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
