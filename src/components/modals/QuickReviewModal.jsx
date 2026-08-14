import { useMemo, useState, useEffect } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD, BRASS } from "../../lib/config/theme";
import { isSrsDue } from "../../lib/utils/quizHelpers";
import { XIcon, CheckIcon, SpeakButton } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { SECTIONS } from "../../lib/config/sections";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";

/**
 * Quick review — short flash session for words that are "due" (need review).
 *
 * Flow (clear steps):
 *  1. See the word only
 *  2. Try to recall the meaning (don't peek)
 *  3. Tap "Show meaning"
 *  4. Tap "I knew it" or "Still learning"
 *  5. Next word…
 */
export default function QuickReviewModal({
  entries, studiedIds, srsDueAt, isAr, onClose, onToggleStudied, onRecordSrsAnswer, limit = 8,
  academicUnits = null, activeUnitId = null,
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

  const due = useMemo(() => {
    const list = (unitFilteredEntries || []).filter(
      (e) => studiedIds.has(e.id) && isSrsDue(e.id, srsDueAt)
    );
    return list.slice(0, limit);
  }, [unitFilteredEntries, studiedIds, srsDueAt, limit]);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("prompt"); // prompt | revealed | done
  const [knew, setKnew] = useState(0);
  const [learning, setLearning] = useState(0);

  function onUnitsChanged() {
    setIdx(0);
    setPhase("prompt");
    setKnew(0);
    setLearning(0);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (phase === "done") return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase === "prompt") setPhase("revealed");
      }
      if (phase === "revealed") {
        if (e.key === "1" || e.key === "y" || e.key === "Y") handleKnew(true);
        if (e.key === "2" || e.key === "n" || e.key === "N") handleKnew(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const entry = due[idx];
  const cfg = entry ? SECTIONS[entry.section] || SECTIONS["en-ar"] : null;
  const total = due.length;

  function handleKnew(ok) {
    if (!entry) return;
    if (ok) setKnew((n) => n + 1);
    else setLearning((n) => n + 1);
    try {
      if (typeof onRecordSrsAnswer === "function") onRecordSrsAnswer(entry.id, ok);
    } catch (_) {}
    if (idx < total - 1) {
      setIdx((i) => i + 1);
      setPhase("prompt");
    } else {
      setPhase("done");
    }
  }

  function restart() {
    setIdx(0);
    setPhase("prompt");
    setKnew(0);
    setLearning(0);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr(isAr, "Quick review", "مراجعة سريعة")}
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
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10, flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: INK }}>
              {tr(isAr, "Quick review", "مراجعة سريعة")}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
              {tr(isAr,
                "A short session for words that need review now (due).",
                "جلسة قصيرة للكلمات اللي محتاجة مراجعة دلوقتي (مستحقة).")}
            </p>
          </div>
          <button type="button" onClick={onClose} style={iconBtn} aria-label={tr(isAr, "Close", "إغلاق")}>
            <XIcon size={18} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>

        <UnitScopePicker
          isAr={isAr}
          hasUnits={hasUnits}
          sortedUnits={sortedUnits}
          selectedUnitIds={selectedUnitIds}
          entries={entries}
          setUnitPreset={setUnitPreset}
          toggleUnit={toggleUnit}
          selectAllUnits={selectAllUnits}
          onChange={onUnitsChanged}
        />

        {total === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 12px" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: INK }}>
              {tr(isAr, "Nothing due right now", "مفيش كلمات مستحقة دلوقتي")}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              {tr(isAr,
                "Mark words as studied, take quizzes, then come back when reviews are due.",
                "علّم كلمات كمدروسة، اعمل اختبارات، وارجع لما تبقى في مراجعات مستحقة.")}
            </p>
            <button type="button" onClick={onClose} style={{ ...primaryBtn, marginTop: 16 }}>
              {tr(isAr, "Close", "إغلاق")}
            </button>
          </div>
        ) : phase === "done" ? (
          <div style={{ textAlign: "center", padding: "20px 8px" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: INK }}>
              {tr(isAr, "Session complete", "الجلسة خلصت")}
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--muted-strong)" }}>
              {tr(isAr, `Knew: ${knew} · Still learning: ${learning}`, `عرفتها: ${knew} · لسه بتعلّم: ${learning}`)}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "center" }}>
              <button type="button" onClick={restart} style={secondaryBtn}>
                {tr(isAr, "Again", "تاني")}
              </button>
              <button type="button" onClick={onClose} style={primaryBtn}>
                {tr(isAr, "Done", "تم")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Progress */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 4, background: "rgba(var(--border-rgb),0.12)", overflow: "hidden" }}>
                <div style={{
                  width: `${((idx + (phase === "revealed" ? 0.5 : 0)) / total) * 100}%`,
                  height: "100%", background: BRASS, transition: "width 0.25s",
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
                {idx + 1} / {total}
              </span>
            </div>

            <div style={{
              textAlign: "center", padding: "28px 12px",
              borderRadius: 14, background: "rgba(var(--border-rgb),0.05)",
              border: "1px solid rgba(var(--border-rgb),0.1)",
              minHeight: 160,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                {phase === "prompt"
                  ? tr(isAr, "Step 1 — Recall", "خطوة 1 — افتكر")
                  : tr(isAr, "Step 2 — Check", "خطوة 2 — راجع")}
              </div>
              <div dir={cfg.wordDir} style={{ fontFamily: cfg.wordFont, fontSize: 28, fontWeight: 700, color: INK, lineHeight: 1.3 }}>
                {entry.word}
              </div>
              <div style={{ marginTop: 8 }}>
                <SpeakButton text={entry.word} dir={cfg.wordDir} isAr={isAr} size={18} />
              </div>

              {phase === "revealed" ? (
                <div dir={cfg.meaningDir} style={{
                  fontFamily: cfg.meaningFont, fontSize: 18, color: "var(--meaning)",
                  marginTop: 18, paddingTop: 14, borderTop: "1px dashed rgba(var(--border-rgb),0.2)",
                  width: "100%",
                }}>
                  {entry.meaning}
                  {entry.definition ? (
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, fontFamily: "inherit" }}>
                      {entry.definition}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--muted)" }}>
                  {tr(isAr, "Think of the meaning, then reveal.", "فكّر في المعنى، بعدين اظهره.")}
                </p>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              {phase === "prompt" ? (
                <button type="button" onClick={() => setPhase("revealed")} style={{ ...primaryBtn, width: "100%" }}>
                  {tr(isAr, "Show meaning", "إظهار المعنى")}
                </button>
              ) : (
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="button" onClick={() => handleKnew(false)} style={{ ...secondaryBtn, flex: 1, justifyContent: "center" }}>
                    {tr(isAr, "Still learning", "لسه بتعلّم")}
                  </button>
                  <button type="button" onClick={() => handleKnew(true)} style={{ ...primaryBtn, flex: 1, background: "var(--success)" }}>
                    <CheckIcon size={16} /> {tr(isAr, "I knew it", "عرفتها")}
                  </button>
                </div>
              )}
            </div>

            <p style={{ margin: "12px 0 0", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
              {tr(isAr, "Keyboard: Space = show · 1 = knew · 2 = learning", "كيبورد: مسافة = إظهار · 1 = عرفتها · 2 = لسه")}
            </p>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

const iconBtn = {
  border: "none", background: "transparent", color: "var(--icon-muted)",
  width: 36, height: 36, padding: 0, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  borderRadius: 10, flexShrink: 0, lineHeight: 0,
};
const primaryBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "12px 16px", borderRadius: 12, border: "none",
  background: BRASS, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
};
const secondaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "12px 14px", borderRadius: 12,
  border: "1px solid rgba(var(--border-rgb),0.22)",
  background: "var(--card)", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer",
};
