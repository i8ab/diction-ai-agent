import { useMemo, useState, useEffect, useRef } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD } from "../../lib/config/theme";
import { srsLevelFromStats, isSrsDue, shuffleArray } from "../../lib/utils/quizHelpers";
import { XIcon, SpeakButton, CheckIcon } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { SECTIONS } from "../../lib/config/sections";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";

/**
 * Sentence Practice — user writes a sentence using the target word.
 * Self-check flow (no AI required): show word → write sentence → reveal
 * example / meaning and mark if they used the word correctly.
 */
export default function SentencePracticeModal({
  entries,
  studiedIds,
  srsStats = {},
  srsDueAt = {},
  isAr,
  onClose,
  onRecordSrsAnswer,
  limit = 8,
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
    const scored = base.map((e) => {
      const stats = srsStats[e.id] || { correct: 0, total: 0 };
      const level = srsLevelFromStats(stats);
      const due = isSrsDue(e.id, srsDueAt) ? 0 : 1;
      return { e, score: due * 8 + level };
    });
    scored.sort((a, b) => a.score - b.score);
    return shuffleArray(scored.map((x) => x.e).slice(0, Math.min(limit * 2, scored.length))).slice(0, limit);
  }, [unitFilteredEntries, studiedIds, srsStats, srsDueAt, limit]);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("write"); // write | review | done
  const [sentence, setSentence] = useState("");
  const [usedWord, setUsedWord] = useState(null); // true/false after self-check
  const [correctCount, setCorrectCount] = useState(0);
  const [skipCount, setSkipCount] = useState(0);
  const inputRef = useRef(null);

  const entry = list[idx];
  const cfg = entry ? SECTIONS[entry.section] || SECTIONS["en-ar"] : null;
  const word = entry?.word || entry?.term || "";
  const total = list.length;

  useEffect(() => {
    if (phase === "write") {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [phase, idx]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function containsWord(text, target) {
    const t = String(target || "").toLowerCase().trim();
    if (!t) return false;
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return re.test(String(text || ""));
  }

  function goReview() {
    if (!sentence.trim()) return;
    setPhase("review");
  }

  function mark(ok) {
    setUsedWord(ok);
    if (ok) setCorrectCount((c) => c + 1);
    else setSkipCount((c) => c + 1);
    try {
      if (typeof onRecordSrsAnswer === "function") onRecordSrsAnswer(entry.id, ok);
    } catch (_) {}
  }

  function next() {
    if (idx < total - 1) {
      setIdx((i) => i + 1);
      setSentence("");
      setUsedWord(null);
      setPhase("write");
    } else {
      setPhase("done");
    }
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
          <div style={{ fontSize: 36, marginBottom: 10 }}>✍️</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
            {tr(isAr, "No words available", "ما فيش كلمات متاحة")}
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
      aria-label={tr(isAr, "Sentence practice", "تمرين الجمل")}
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
          width: "100%", maxWidth: 460, background: CARD,
          borderRadius: 18, padding: "20px 18px 18px",
          border: "1px solid rgba(var(--border-rgb),0.14)",
          boxShadow: "0 24px 56px -16px rgba(0,0,0,0.45)",
          maxHeight: "min(90dvh, 680px)",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'Source Sans 3', sans-serif", fontSize: 13, fontWeight: 700, color: "var(--muted-strong)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {tr(isAr, "Sentence practice", "تمرين الجمل")}
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
          onChange={() => { setIdx(0); setPhase("write"); setSentence(""); setUsedWord(null); setCorrectCount(0); setSkipCount(0); }}
        />

        {phase === "done" ? (
          <div style={{ padding: "28px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>✍️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK, marginBottom: 8 }}>
              {tr(isAr, "Nice work!", "شغل ممتاز!")}
            </div>
            <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
              {tr(isAr, `Used correctly: ${correctCount} · Skipped/missed: ${skipCount}`, `استخدمت صح: ${correctCount} · تخطيت/غلط: ${skipCount}`)}
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
            {/* Word card */}
            <div
              style={{
                padding: "16px 14px", borderRadius: 14, marginBottom: 14,
                background: "rgba(var(--border-rgb),0.05)", textAlign: "center",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
                {tr(isAr, "Use this word", "استخدم الكلمة دي")}
              </div>
              <div
                style={{
                  fontSize: 26, fontWeight: 700, color: INK, marginBottom: 6,
                  direction: cfg?.rtl ? "rtl" : "ltr",
                }}
              >
                {word}
              </div>
              {(entry?.meaning || entry?.translation) && (
                <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 6 }}>
                  {entry.meaning || entry.translation}
                </div>
              )}
              <SpeakButton text={word} dir={cfg?.wordDir || "ltr"} isAr={isAr} size={20} />
            </div>

            {phase === "write" && (
              <>
                <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-strong)", marginBottom: 6, display: "block" }}>
                  {tr(isAr, "Write a sentence with this word", "اكتب جملة باستخدام الكلمة")}
                </label>
                <textarea
                  ref={inputRef}
                  value={sentence}
                  onChange={(e) => setSentence(e.target.value)}
                  rows={3}
                  placeholder={tr(isAr, "Type your sentence here…", "اكتب جملتك هنا…")}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12,
                    border: "1px solid rgba(var(--border-rgb),0.25)", background: "var(--input-bg)",
                    fontSize: 16, color: INK, outline: "none", resize: "vertical",
                    fontFamily: "'Source Sans 3', sans-serif", lineHeight: 1.5,
                  }}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => { setSkipCount((c) => c + 1); next(); }}
                    style={{
                      flex: 1, padding: "12px 10px", borderRadius: 12,
                      border: "1px solid rgba(var(--border-rgb),0.25)",
                      background: "transparent", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}
                  >
                    {tr(isAr, "Skip", "تخطي")}
                  </button>
                  <button
                    type="button"
                    onClick={goReview}
                    disabled={!sentence.trim()}
                    style={{
                      flex: 2, padding: "12px 10px", borderRadius: 12, border: "none",
                      background: sentence.trim()
                        ? "linear-gradient(135deg, var(--accent-1), var(--accent-2))"
                        : "rgba(var(--border-rgb),0.15)",
                      color: sentence.trim() ? "#fff" : "var(--muted)",
                      fontWeight: 700, fontSize: 14, cursor: sentence.trim() ? "pointer" : "default",
                    }}
                  >
                    {tr(isAr, "Check", "تحقق")}
                  </button>
                </div>
              </>
            )}

            {phase === "review" && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                    {tr(isAr, "Your sentence", "جملتك")}
                  </div>
                  <div
                    style={{
                      padding: "12px 14px", borderRadius: 12,
                      background: "rgba(var(--border-rgb),0.06)", fontSize: 15, lineHeight: 1.5, color: INK,
                    }}
                  >
                    {sentence}
                  </div>
                  {containsWord(sentence, word) ? (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#34c759", fontWeight: 600 }}>
                      ✓ {tr(isAr, "Word appears in your sentence", "الكلمة موجودة في جملتك")}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
                      ✗ {tr(isAr, "Word not found in sentence", "الكلمة مش موجودة في الجملة")}
                    </div>
                  )}
                </div>

                {entry?.example && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
                      {tr(isAr, "Example", "مثال")}
                    </div>
                    <div style={{ fontSize: 14, fontStyle: "italic", color: "var(--muted-strong)", lineHeight: 1.45 }}>
                      {entry.example}
                    </div>
                  </div>
                )}

                {usedWord == null ? (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, textAlign: "center" }}>
                      {tr(isAr, "Did you use the word correctly?", "استخدمت الكلمة صح؟")}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => mark(false)}
                        style={{
                          flex: 1, padding: "12px 10px", borderRadius: 12,
                          border: "1px solid rgba(var(--border-rgb),0.25)",
                          background: "transparent", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer",
                        }}
                      >
                        {tr(isAr, "Not really", "مش أوي")}
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(true)}
                        style={{
                          flex: 1, padding: "12px 10px", borderRadius: 12, border: "none",
                          background: "linear-gradient(135deg, #34c759, #30b350)",
                          color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        }}
                      >
                        <CheckIcon size={16} />
                        {tr(isAr, "Yes", "أيوا")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={next}
                    style={{
                      width: "100%", padding: "13px 16px", borderRadius: 12, border: "none",
                      background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                      color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
                    }}
                  >
                    {idx < total - 1 ? tr(isAr, "Next word", "الكلمة التالية") : tr(isAr, "Finish", "إنهاء")}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
