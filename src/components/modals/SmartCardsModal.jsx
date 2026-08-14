import { useState, useEffect, useMemo, useRef } from "react";
import { tr } from "../../lib/config/i18n";
import { INK, CARD, BRASS, labelStyle, primaryBtnStyle } from "../../lib/config/theme";
import { shuffleArray, pickEntryExample, makeClozeFromExample } from "../../lib/utils/quizHelpers";
import { XIcon, LayersIcon, SpeakerIcon, CheckIcon } from "../common/Icons";
import UnitScopePicker, { useUnitScope } from "../common/UnitScopePicker";
import { BodyScrollLock } from "../../lib/utils/useBodyScrollLock";
import { SECTIONS } from "../../lib/config/sections";

/**
 * Smart reverse memory cards — multiple prompt styles in one deck:
 *  - meaning → type the word
 *  - cloze (sentence with blank)
 *  - audio only → type the word
 *  - classic flip (word ↔ meaning)
 */

const MODES = [
  { id: "classic", en: "Classic flip", ar: "قلب عادي" },
  { id: "type", en: "Meaning → type word", ar: "معنى → اكتب الكلمة" },
  { id: "cloze", en: "Fill the blank", ar: "أكمل الفراغ" },
  { id: "audio", en: "Audio only", ar: "صوت فقط" },
  { id: "mix", en: "Smart mix", ar: "خلط ذكي" },
];

function normalize(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function speak(text, dir) {
  try {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = dir === "rtl" ? "ar-SA" : "en-US";
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

export default function SmartCardsModal({
  entries,
  studiedIds,
  favoriteIds,
  isAr,
  onClose,
  onRecordSrsAnswer,
  onXp,
  academicUnits = null,
  activeUnitId = null,
}) {
  const [mode, setMode] = useState("mix");
  const [filterKey, setFilterKey] = useState("studied");
  const [deck, setDeck] = useState(null);
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState("prompt"); // prompt | reveal | done
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState(null); // correct | wrong
  const [knew, setKnew] = useState(0);
  const [missed, setMissed] = useState(0);
  const inputRef = useRef(null);

  const {
    hasUnits,
    sortedUnits,
    selectedUnitIds,
    unitFilteredEntries,
    setUnitPreset,
    toggleUnit,
    selectAllUnits,
  } = useUnitScope(academicUnits, activeUnitId, entries);

  const pool = useMemo(() => {
    let list = unitFilteredEntries || [];
    if (filterKey === "studied") list = list.filter((e) => studiedIds && studiedIds.has(e.id));
    if (filterKey === "favorites") list = list.filter((e) => favoriteIds && favoriteIds.has(e.id));
    return list;
  }, [unitFilteredEntries, filterKey, studiedIds, favoriteIds]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (phase === "prompt" && deck && (deck[pos]?.cardMode === "type" || deck[pos]?.cardMode === "cloze" || deck[pos]?.cardMode === "audio")) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [phase, pos, deck]);

  function pickCardMode(entry, preferred) {
    if (preferred && preferred !== "mix") return preferred;
    const options = ["classic", "type"];
    if (pickEntryExample(entry)) options.push("cloze");
    options.push("audio");
    return options[Math.floor(Math.random() * options.length)];
  }

  function startDeck() {
    const base = shuffleArray(pool).slice(0, 20);
    const built = base.map((e) => {
      let cardMode = pickCardMode(e, mode);
      const example = pickEntryExample(e);
      let cloze = null;
      if (cardMode === "cloze") {
        cloze = example ? makeClozeFromExample(example, e.word) : null;
        if (!cloze || !cloze.ok) cardMode = "type";
      }
      return { entry: e, cardMode, cloze, example };
    });
    setDeck(built);
    setPos(0);
    setPhase("prompt");
    setTyped("");
    setFeedback(null);
    setKnew(0);
    setMissed(0);
  }

  const current = deck && deck[pos];
  const entry = current && current.entry;
  const cfg = entry ? SECTIONS[entry.section] || SECTIONS["en-ar"] : null;

  function mark(ok) {
    if (!entry) return;
    if (ok) setKnew((n) => n + 1);
    else setMissed((n) => n + 1);
    try {
      if (typeof onRecordSrsAnswer === "function") onRecordSrsAnswer(entry.id, ok);
    } catch (_) {}
    try {
      if (ok && typeof onXp === "function") onXp(entry.id);
    } catch (_) {}
    if (pos < deck.length - 1) {
      setPos((i) => i + 1);
      setPhase("prompt");
      setTyped("");
      setFeedback(null);
    } else {
      setPhase("done");
    }
  }

  function checkTyped() {
    if (!entry) return;
    const ok = normalize(typed) === normalize(entry.word);
    setFeedback(ok ? "correct" : "wrong");
    setPhase("reveal");
  }

  function renderPrompt() {
    if (!entry || !cfg) return null;
    const m = current.cardMode;

    if (m === "classic") {
      return (
        <div
          onClick={() => setPhase("reveal")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPhase("reveal"); }}
          style={{
            minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, borderRadius: 16, background: "var(--input-bg)", border: "1px solid rgba(var(--border-rgb),0.15)",
            cursor: "pointer", textAlign: "center",
          }}
        >
          <div>
            <div dir={cfg.wordDir} style={{ fontFamily: cfg.wordFont, fontSize: 28, fontWeight: 700, color: INK }}>{entry.word}</div>
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted-strong)" }}>
              {tr(isAr, "Tap to reveal meaning", "اضغط لإظهار المعنى")}
            </div>
          </div>
        </div>
      );
    }

    if (m === "audio") {
      return (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <button
            type="button"
            onClick={() => speak(entry.word, cfg.wordDir)}
            style={{
              width: 72, height: 72, borderRadius: "50%", border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))", color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 10px 24px -12px rgba(var(--focus-rgb),0.6)",
            }}
            aria-label={tr(isAr, "Play audio", "تشغيل الصوت")}
          >
            <SpeakerIcon size={28} />
          </button>
          <div style={{ marginTop: 14, fontSize: 13, color: "var(--muted-strong)" }}>
            {tr(isAr, "Listen, then type the word", "اسمع، بعدين اكتب الكلمة")}
          </div>
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") checkTyped(); }}
            dir={cfg.wordDir}
            placeholder={tr(isAr, "Type the word…", "اكتب الكلمة…")}
            style={{
              marginTop: 16, width: "100%", boxSizing: "border-box", padding: "12px 14px",
              fontSize: 18, fontFamily: cfg.wordFont, borderRadius: 10,
              border: "1px solid rgba(var(--border-rgb),0.2)", background: "var(--input-bg)", color: INK,
            }}
          />
          <button type="button" onClick={checkTyped} style={{ ...primaryBtnStyle, marginTop: 12 }}>
            {tr(isAr, "Check", "تحقق")}
          </button>
        </div>
      );
    }

    if (m === "cloze" && current.cloze && current.cloze.ok) {
      return (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-1)", marginBottom: 8 }}>
            {tr(isAr, "Fill the blank", "أكمل الفراغ")}
          </div>
          <div dir={cfg.wordDir} style={{ fontFamily: cfg.wordFont, fontSize: 18, lineHeight: 1.6, color: INK, marginBottom: 16 }}>
            {current.cloze.blanked || current.cloze.sentence}
          </div>
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") checkTyped(); }}
            dir={cfg.wordDir}
            placeholder={tr(isAr, "Missing word…", "الكلمة الناقصة…")}
            style={{
              width: "100%", boxSizing: "border-box", padding: "12px 14px",
              fontSize: 18, fontFamily: cfg.wordFont, borderRadius: 10,
              border: "1px solid rgba(var(--border-rgb),0.2)", background: "var(--input-bg)", color: INK,
            }}
          />
          <button type="button" onClick={checkTyped} style={{ ...primaryBtnStyle, marginTop: 12 }}>
            {tr(isAr, "Check", "تحقق")}
          </button>
        </div>
      );
    }

    // type (meaning → word)
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-1)", marginBottom: 8 }}>
          {tr(isAr, "What is the word for…", "ما هي كلمة…")}
        </div>
        <div dir={cfg.meaningDir} style={{ fontFamily: cfg.meaningFont, fontSize: 22, fontWeight: 600, color: INK, marginBottom: 16 }}>
          {entry.meaning}
        </div>
        <input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") checkTyped(); }}
          dir={cfg.wordDir}
          placeholder={tr(isAr, "Type the word…", "اكتب الكلمة…")}
          style={{
            width: "100%", boxSizing: "border-box", padding: "12px 14px",
            fontSize: 18, fontFamily: cfg.wordFont, borderRadius: 10,
            border: "1px solid rgba(var(--border-rgb),0.2)", background: "var(--input-bg)", color: INK,
          }}
        />
        <button type="button" onClick={checkTyped} style={{ ...primaryBtnStyle, marginTop: 12 }}>
          {tr(isAr, "Check", "تحقق")}
        </button>
      </div>
    );
  }

  function renderReveal() {
    if (!entry || !cfg) return null;
    const ok = feedback === "correct" || current.cardMode === "classic";
    return (
      <div>
        {feedback && (
          <div style={{
            marginBottom: 12, padding: "10px 12px", borderRadius: 10, fontWeight: 700, fontSize: 14,
            background: feedback === "correct" ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.12)",
            color: feedback === "correct" ? "#30d158" : "var(--danger)",
          }}>
            {feedback === "correct"
              ? tr(isAr, "Correct!", "صح!")
              : tr(isAr, `Answer: ${entry.word}`, `الإجابة: ${entry.word}`)}
          </div>
        )}
        <div dir={cfg.wordDir} style={{ fontFamily: cfg.wordFont, fontSize: 26, fontWeight: 700, color: INK }}>{entry.word}</div>
        <div dir={cfg.meaningDir} style={{ fontFamily: cfg.meaningFont, fontSize: 18, marginTop: 8, color: "var(--meaning)" }}>{entry.meaning}</div>
        {entry.example && (
          <div dir={cfg.wordDir} style={{ marginTop: 12, fontSize: 14, color: "var(--muted-strong)", fontStyle: "italic" }}>
            “{entry.example}”
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={() => mark(false)}
            style={{
              flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(var(--border-rgb),0.2)",
              background: "var(--input-bg)", color: INK, fontWeight: 700, cursor: "pointer",
            }}
          >
            {tr(isAr, "Still learning", "لسه بتعلمها")}
          </button>
          <button
            type="button"
            onClick={() => mark(true)}
            style={{
              flex: 1, padding: "12px", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg, #30d158, #34c759)", color: "#fff", fontWeight: 700, cursor: "pointer",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <CheckIcon size={16} /> {tr(isAr, "I knew it", "عرفتها")}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={tr(isAr, "Smart cards", "بطاقات ذكية")}
      style={{
        position: "fixed", inset: 0, zIndex: 6000, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.45)", padding: "max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom))",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <BodyScrollLock />
      <div
        className="modal-card responsive-modal"
        style={{
          width: "100%", maxWidth: 480, maxHeight: "92dvh", overflow: "hidden",
          display: "flex", flexDirection: "column",
          background: CARD, borderRadius: 18, padding: "18px 18px 22px",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
            }}>
              <LayersIcon size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: INK }}>{tr(isAr, "Smart cards", "بطاقات ذكية")}</div>
              {deck && phase !== "done" && (
                <div style={{ fontSize: 12, color: "var(--muted-strong)" }}>{pos + 1} / {deck.length}</div>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--icon-muted)", padding: 6 }}>
            <XIcon size={20} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>


        {!deck && (
          <div>
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
            <div style={labelStyle}>{tr(isAr, "Card style", "نوع البطاقة")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
                    padding: "8px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: mode === m.id ? "2px solid var(--accent-1)" : "1px solid rgba(var(--border-rgb),0.2)",
                    background: mode === m.id ? "rgba(var(--focus-rgb),0.12)" : "var(--input-bg)",
                    color: INK,
                  }}
                >
                  {isAr ? m.ar : m.en}
                </button>
              ))}
            </div>

            <div style={labelStyle}>{tr(isAr, "Word pool", "مجموعة الكلمات")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                { id: "studied", en: "Studied", ar: "المُذاكرة" },
                { id: "favorites", en: "Favorites", ar: "المفضلة" },
                { id: "all", en: "All words", ar: "كل الكلمات" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterKey(f.id)}
                  style={{
                    padding: "8px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: filterKey === f.id ? "2px solid var(--accent-1)" : "1px solid rgba(var(--border-rgb),0.2)",
                    background: filterKey === f.id ? "rgba(var(--focus-rgb),0.12)" : "var(--input-bg)",
                    color: INK,
                  }}
                >
                  {isAr ? f.ar : f.en}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted-strong)" }}>
              {tr(isAr, `${pool.length} words available`, `${pool.length} كلمة متاحة`)}
            </div>

            <button
              type="button"
              disabled={pool.length === 0}
              onClick={startDeck}
              style={{ ...primaryBtnStyle, opacity: pool.length === 0 ? 0.5 : 1 }}
            >
              {tr(isAr, "Start session", "ابدأ الجلسة")}
            </button>
          </div>
        )}

        {deck && phase === "done" && (
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✨</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: INK }}>{tr(isAr, "Session complete", "انتهت الجلسة")}</div>
            <div style={{ marginTop: 10, fontSize: 15, color: "var(--muted-strong)" }}>
              {tr(isAr, `Knew: ${knew} · Still learning: ${missed}`, `عرفتها: ${knew} · لسه: ${missed}`)}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => setDeck(null)} style={{
                flex: 1, padding: "12px", borderRadius: 12, border: "1px solid rgba(var(--border-rgb),0.2)",
                background: "var(--input-bg)", color: INK, fontWeight: 700, cursor: "pointer",
              }}>
                {tr(isAr, "New session", "جلسة جديدة")}
              </button>
              <button type="button" onClick={onClose} style={{ ...primaryBtnStyle, marginTop: 0, flex: 1 }}>
                {tr(isAr, "Done", "تم")}
              </button>
            </div>
          </div>
        )}

        {deck && phase !== "done" && (
          <div>
            <div style={{
              height: 4, borderRadius: 2, background: "rgba(var(--border-rgb),0.15)", marginBottom: 16, overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${((pos + (phase === "reveal" ? 1 : 0)) / deck.length) * 100}%`,
                background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))", transition: "width 0.25s ease",
              }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--accent-1)", marginBottom: 8 }}>
              {MODES.find((m) => m.id === current.cardMode)?.[isAr ? "ar" : "en"] || current.cardMode}
            </div>
            {phase === "prompt" ? renderPrompt() : renderReveal()}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
