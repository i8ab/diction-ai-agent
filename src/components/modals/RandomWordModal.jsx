import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD, BRASS } from "../../lib/config/theme";
import { isSrsDue } from "../../lib/utils/quizHelpers";
import { SpeakButton, XIcon, CheckIcon, EyeIcon } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";

/**
 * Shuffle a copy of an array (Fisher–Yates).
 */
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * Fast "random word" practice: show word → Knew it / Forgot / Reveal.
 * Updates SRS via onRecordSrsAnswer. Marks studied when the user practices a word.
 */
export default function RandomWordModal({
  entries,
  studiedIds,
  srsDueAt,
  isAr,
  section,
  onClose,
  onRecordSrsAnswer,
  onToggleStudied,
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

  const studiedSet = useMemo(
    () => (studiedIds instanceof Set ? studiedIds : new Set(studiedIds || [])),
    [studiedIds]
  );

  // Prefer: due studied → not yet studied → other studied → everything in section
  const pool = useMemo(() => {
    const list = (unitFilteredEntries || []).filter((e) => e.section === section || !section);
    if (!list.length) return [];
    const due = list.filter((e) => studiedSet.has(e.id) && isSrsDue(e.id, srsDueAt));
    if (due.length >= 2) return due;
    const notStudied = list.filter((e) => !studiedSet.has(e.id));
    if (notStudied.length >= 1) {
      return notStudied.length >= 3 ? notStudied : [...notStudied, ...due];
    }
    const studied = list.filter((e) => studiedSet.has(e.id));
    if (studied.length >= 1) return studied;
    return list;
  }, [unitFilteredEntries, studiedSet, srsDueAt, section]);

  const [current, setCurrent] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [cycleShown, setCycleShown] = useState(0);
  const [cycleTotal, setCycleTotal] = useState(0);
  // Bag of remaining ids for this cycle — no repeats until the bag is empty.
  const bagRef = useRef([]);
  const lastIdRef = useRef(null);

  const refillBag = useCallback(
    (preferNotId) => {
      let ids = shuffled(pool.map((e) => e.id));
      if (preferNotId && ids.length > 1) {
        // Avoid starting the new cycle with the same word we just finished.
        if (ids[0] === preferNotId) {
          const swap = ids.findIndex((id) => id !== preferNotId);
          if (swap > 0) {
            const tmp = ids[0];
            ids[0] = ids[swap];
            ids[swap] = tmp;
          }
        }
      }
      bagRef.current = ids;
      setCycleTotal(ids.length);
      setCycleShown(0);
    },
    [pool]
  );

  const pickNext = useCallback(() => {
    if (!pool.length) {
      setCurrent(null);
      lastIdRef.current = null;
      return;
    }
    if (!bagRef.current.length) {
      refillBag(lastIdRef.current);
    }
    // Safety: if bag still empty (pool emptied), bail.
    if (!bagRef.current.length) {
      setCurrent(null);
      return;
    }
    const nextId = bagRef.current.shift();
    const next = pool.find((e) => e.id === nextId) || pool[0];
    lastIdRef.current = next.id;
    setCycleShown((n) => n + 1);
    setCurrent(next);
    setFlipped(false);
  }, [pool, refillBag]);

  // Rebuild bag when the pool identity changes (section switch / new words).
  useEffect(() => {
    bagRef.current = [];
    lastIdRef.current = null;
    pickNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, pool.length]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (!current) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped(true);
      }
      if (e.key === "1" && flipped) handleKnew(true);
      if (e.key === "2" && flipped) handleKnew(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /** Mark as studied if not already (toggle only when currently unstudied). */
  function ensureStudied(entryId) {
    if (!onToggleStudied || !entryId) return;
    if (!studiedSet.has(entryId)) {
      onToggleStudied(entryId);
    }
  }

  function handleKnew(ok) {
    if (!current) return;
    setSessionTotal((t) => t + 1);
    if (ok) setSessionCorrect((c) => c + 1);
    if (onRecordSrsAnswer) onRecordSrsAnswer(current.id, ok);
    // Any answer counts as studying this word.
    ensureStudied(current.id);
    pickNext();
  }

  function handleMarkStudiedOnly() {
    if (!current) return;
    ensureStudied(current.id);
  }

  const isCurrentStudied = current ? studiedSet.has(current.id) : false;
  const cfgDir = current?.section === "ar-ar" ? "rtl" : "ltr";
  const wordFont = current?.section === "ar-ar" ? "'Amiri', serif" : "'Fraunces', serif";

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
          maxWidth: 420,
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: INK }}>
            {tr(isAr, "Random word", "كلمة عشوائية")}
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

        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--muted)" }}>
          {sessionTotal > 0
            ? `${sessionCorrect}/${sessionTotal} ${tr(isAr, "this session", "في الجلسة")}`
            : tr(isAr, "No repeats until every word in the set is shown", "من غير تكرار لحد ما تخلص كل الكلمات")}
          {cycleTotal > 0 && (
            <span style={{ marginInlineStart: 6, opacity: 0.85 }}>
              · {cycleShown}/{cycleTotal} {tr(isAr, "in this round", "في الجولة")}
            </span>
          )}
        </p>

        {!current ? (
          <p style={{ textAlign: "center", color: "var(--muted-strong)", padding: 24 }}>
            {tr(isAr, "No words available in this section.", "مفيش كلمات في القسم ده.")}
          </p>
        ) : (
          <>
            <div
              onClick={() => setFlipped(true)}
              style={{
                minHeight: 140,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px 16px",
                borderRadius: 14,
                border: "1px solid rgba(var(--border-rgb),0.15)",
                background: "var(--input-bg)",
                cursor: flipped ? "default" : "pointer",
                textAlign: "center",
                gap: 10,
              }}
            >
              <div dir={cfgDir} style={{ fontFamily: wordFont, fontSize: 28, fontWeight: 700, color: INK }}>
                {current.word}
              </div>
              <SpeakButton text={current.word} dir={cfgDir} isAr={isAr} size={22} style={{ color: BRASS }} />
              {flipped ? (
                <div dir="rtl" style={{ fontFamily: "'Amiri', serif", fontSize: 20, color: "var(--meaning)", marginTop: 6 }}>
                  {current.meaning}
                </div>
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 10 }}>
                  <EyeIcon size={14} /> {tr(isAr, "Tap to reveal", "اضغط للإظهار")}
                </span>
              )}
              {flipped && current.example && (
                <div style={{ fontSize: 13, color: "var(--muted-strong)", marginTop: 4, fontStyle: "italic" }}>
                  {current.example}
                </div>
              )}
            </div>

            {/* Explicit studied control — works even before answering */}
            <button
              type="button"
              onClick={handleMarkStudiedOnly}
              disabled={isCurrentStudied}
              style={{
                width: "100%",
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: isCurrentStudied ? "1px solid rgba(var(--border-rgb),0.2)" : "1px solid var(--accent-1)",
                background: isCurrentStudied ? "var(--input-bg)" : "rgba(var(--accent-rgb, 25,167,206), 0.12)",
                color: isCurrentStudied ? "var(--muted-strong)" : "var(--accent-1)",
                fontWeight: 700,
                fontSize: 14,
                cursor: isCurrentStudied ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <CheckIcon size={15} />
              {isCurrentStudied
                ? tr(isAr, "Marked as studied", "مُعلَّمة كمُذاكرة")
                : tr(isAr, "Mark as studied", "علّم كمُذاكرة")}
            </button>

            {flipped && (
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => handleKnew(false)}
                  style={{
                    flex: 1,
                    padding: "14px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--danger-bg)",
                    color: "var(--danger)",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: "pointer",
                  }}
                >
                  {tr(isAr, "Forgot", "نسيتها")}
                </button>
                <button
                  type="button"
                  onClick={() => handleKnew(true)}
                  style={{
                    flex: 1,
                    padding: "14px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <CheckIcon size={16} /> {tr(isAr, "Knew it", "عرفتها")}
                </button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
