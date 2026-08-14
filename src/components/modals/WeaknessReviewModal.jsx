import { useMemo, useState, useEffect } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD, BRASS } from "../../lib/config/theme";
import { srsLevelFromStats, isSrsDue } from "../../lib/utils/quizHelpers";
import { XIcon, CheckIcon, SpeakButton } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { SECTIONS } from "../../lib/config/sections";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";

/**
 * Weakness Review — prioritizes words the user struggles with
 * (low accuracy, low SRS box, or many recent failures).
 *
 * Ranking score (lower = weaker / higher priority):
 *   - Primary: srsLevel (0..5)
 *   - Secondary: accuracy ratio
 *   - Tertiary: total attempts (more attempts with low accuracy = weaker)
 */
function weaknessScore(entryId, srsStats, srsDueAt, wordPriorities = {}) {
  const stats = (srsStats && srsStats[entryId]) || { correct: 0, total: 0 };
  const level = srsLevelFromStats(stats);
  const total = stats.total || 0;
  const correct = stats.correct || 0;
  const ratio = total > 0 ? correct / total : 0;
  // Lower score = weaker / higher review priority.
  const dueBoost = isSrsDue(entryId, srsDueAt) ? -0.3 : 0;
  const prio = Number(wordPriorities[entryId]) || 0;
  const prioBoost = prio === 3 ? -1.2 : prio === 2 ? -0.6 : prio === 1 ? -0.2 : 0;
  return level + ratio * 0.5 + Math.min(total, 20) * 0.01 + dueBoost + prioBoost;
}

export default function WeaknessReviewModal({
  entries,
  studiedIds,
  srsStats = {},
  srsDueAt = {},
  wordPriorities = {},
  isAr,
  onClose,
  onRecordSrsAnswer,
  limit = 12,
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

  function buildWeakList(source) {
    const hasWord = (e) => e && String(e.word || e.term || "").trim();
    const list = (source || []).filter((e) => studiedIds.has(e.id) && hasWord(e));
    const filtered = list.filter((e) => {
      const stats = srsStats[e.id] || { correct: 0, total: 0 };
      const total = stats.total || 0;
      const correct = stats.correct || 0;
      if (total < 2) return false;
      const ratio = correct / total;
      if (ratio >= 0.9) return false;
      if (ratio >= 0.85 && total >= 6) return false;
      const level = srsLevelFromStats(stats);
      return level <= 2 || ratio < 0.75;
    });
    filtered.sort((a, b) => {
      const sa = weaknessScore(a.id, srsStats, srsDueAt, wordPriorities);
      const sb = weaknessScore(b.id, srsStats, srsDueAt, wordPriorities);
      return sa - sb;
    });
    return filtered.slice(0, limit);
  }

  // Freeze queue so answering doesn't shrink the list mid-session
  const [weakList, setWeakList] = useState(() => buildWeakList(unitFilteredEntries));
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("prompt"); // prompt | revealed | done
  const [knew, setKnew] = useState(0);
  const [learning, setLearning] = useState(0);

  const unitKey = selectedUnitIds ? [...selectedUnitIds].sort().join(",") : "";
  useEffect(() => {
    setWeakList(buildWeakList(unitFilteredEntries));
    setIdx(0);
    setPhase("prompt");
    setKnew(0);
    setLearning(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitKey]);

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

  const entry = weakList[idx];
  const cfg = entry ? SECTIONS[entry.section] || SECTIONS["en-ar"] : null;
  const total = weakList.length;
  const stats = entry ? srsStats[entry.id] || { correct: 0, total: 0 } : null;
  const level = stats ? srsLevelFromStats(stats) : 0;
  const ratio = stats && stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : null;

  function handleKnew(ok) {
    if (!entry || phase === "done") return;
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

  const levelLabels = isAr
    ? ["ضعيف جداً", "ضعيف", "متوسط", "جيد", "قوي", "متقن"]
    : ["Very weak", "Weak", "Fair", "Good", "Strong", "Mastered"];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr(isAr, "Weakness review", "مراجعة الضعف")}
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
              {tr(isAr, "Weakness review", "مراجعة الضعف")}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {total > 0
                ? tr(isAr, `${idx + 1} / ${total}`, `${idx + 1} / ${total}`)
                : tr(isAr, "No weak words", "لا توجد كلمات ضعيفة")}
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
        />

        {total === 0 ? (
          <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--muted)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💪</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: INK, marginBottom: 6 }}>
              {tr(isAr, "No weak words right now", "ما فيش كلمات ضعيفة حالياً")}
            </div>
            <div style={{ fontSize: 13 }}>
              {tr(isAr, "Keep studying — weak words will appear here.", "كمل مذاكرة — الكلمات الضعيفة هتظهر هنا.")}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                marginTop: 20, padding: "10px 20px", borderRadius: 12, border: "none",
                background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}
            >
              {tr(isAr, "Close", "إغلاق")}
            </button>
          </div>
        ) : phase === "done" ? (
          <div style={{ padding: "28px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>🎯</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: INK, marginBottom: 8 }}>
              {tr(isAr, "Session done!", "انتهت الجلسة!")}
            </div>
            <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
              {tr(isAr, `Knew: ${knew} · Still learning: ${learning}`, `عرفتها: ${knew} · لسه بتذاكر: ${learning}`)}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                type="button"
                onClick={restart}
                style={{
                  padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(var(--border-rgb),0.25)",
                  background: "transparent", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {tr(isAr, "Again", "مرة تانية")}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "10px 18px", borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                  color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}
              >
                {tr(isAr, "Done", "تم")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Card */}
            <div
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "18px 8px", minHeight: 180,
                background: "rgba(var(--border-rgb),0.04)", borderRadius: 14, marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, fontWeight: 600 }}>
                {levelLabels[level] || levelLabels[0]}
                {ratio != null ? ` · ${ratio}%` : ""}
              </div>
              <div
                style={{
                  fontSize: 28, fontWeight: 700, color: INK, textAlign: "center",
                  lineHeight: 1.3, marginBottom: 8, wordBreak: "break-word",
                  direction: cfg?.rtl ? "rtl" : "ltr",
                }}
              >
                {String(entry?.word || entry?.term || "").trim() || "—"}
              </div>
              {entry?.phonetic && (
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
                  /{entry.phonetic}/
                </div>
              )}
              <SpeakButton text={entry?.word || entry?.term} dir={cfg?.wordDir || "ltr"} isAr={isAr} size={22} />

              {phase === "revealed" && (
                <div
                  style={{
                    marginTop: 16, padding: "12px 14px", borderRadius: 12,
                    background: "rgba(var(--accent-1-rgb, 100,100,100),0.08)",
                    width: "100%", textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 600, color: INK, direction: isAr ? "rtl" : "ltr" }}>
                    {entry?.meaning
                      || entry?.translation
                      || entry?.def
                      || (Array.isArray(entry?.senses) && entry.senses[0] && (entry.senses[0].meaning || entry.senses[0].def))
                      || "—"}
                  </div>
                  {entry?.example && (
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, fontStyle: "italic" }}>
                      {entry.example}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            {phase === "prompt" ? (
              <button
                type="button"
                onClick={() => setPhase("revealed")}
                style={{
                  width: "100%", padding: "13px 16px", borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                  color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
                }}
              >
                {tr(isAr, "Show meaning", "أظهر المعنى")}
              </button>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => handleKnew(false)}
                  style={{
                    flex: 1, padding: "13px 12px", borderRadius: 12,
                    border: "1px solid rgba(var(--border-rgb),0.25)",
                    background: "transparent", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer",
                  }}
                >
                  {tr(isAr, "Still learning", "لسه بتذاكر")}
                </button>
                <button
                  type="button"
                  onClick={() => handleKnew(true)}
                  style={{
                    flex: 1, padding: "13px 12px", borderRadius: 12, border: "none",
                    background: "linear-gradient(135deg, #34c759, #30b350)",
                    color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <CheckIcon size={16} />
                  {tr(isAr, "I knew it", "عرفتها")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
