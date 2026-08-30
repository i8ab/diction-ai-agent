import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { tr } from "../../lib/config/i18n";

const NAV_STORAGE_KEY = "twoTongues.mobileNavTabs";

/** All available nav destinations the user can place in the bottom bar. */
export const ALL_NAV_ITEMS = [
  {
    key: "words",
    labelEn: "Words",
    labelAr: "كلمات",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    key: "quiz",
    labelEn: "Quiz",
    labelAr: "اختبار",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    key: "goals",
    labelEn: "Goals",
    labelAr: "أهداف",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    key: "todo",
    labelEn: "To-do",
    labelAr: "مهام",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M3 12h6" />
        <path d="M3 6h6" />
        <path d="M3 18h6" />
      </svg>
    ),
  },
  {
    key: "account",
    labelEn: "Account",
    labelAr: "حسابي",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    key: "add",
    labelEn: "Add word",
    labelAr: "إضافة كلمة",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    key: "more",
    labelEn: "More",
    labelAr: "المزيد",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="6" cy="12" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

const DEFAULT_TAB_KEYS = ["words", "quiz", "goals", "todo", "account"];

export function loadNavTabKeys() {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return [...DEFAULT_TAB_KEYS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return [...DEFAULT_TAB_KEYS];
    const valid = parsed.filter((k) => ALL_NAV_ITEMS.some((i) => i.key === k));
    return valid.length ? valid : [...DEFAULT_TAB_KEYS];
  } catch (_) {
    return [...DEFAULT_TAB_KEYS];
  }
}

export function saveNavTabKeys(keys) {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(keys));
  } catch (_) {}
}

/**
 * ARC-style floating bottom nav (mobile + tablet).
 * Fully customizable: user chooses which items appear and in which order.
 */
export default function MobileBottomNav({
  isAr,
  mobileNavTab,
  setMobileNavTab,
  showQuiz,
  showGoals,
  showTodo,
  dueCountMobile = 0,
  onOpenQuiz,
  onOpenDueQuiz,
  onOpenGoals,
  onOpenTodo,
  onOpenAccount,
  onOpenAdd,
  onOpenMore,
  tabKeys: controlledTabKeys,
  onChangeTabKeys,
}) {
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const [light, setLight] = useState({ x: 0, w: 48, ready: false });
  const [localKeys, setLocalKeys] = useState(loadNavTabKeys);
  const [editMode, setEditMode] = useState(false);

  const tabKeys = controlledTabKeys || localKeys;

  const setTabKeys = useCallback(
    (next) => {
      const keys = typeof next === "function" ? next(tabKeys) : next;
      if (onChangeTabKeys) onChangeTabKeys(keys);
      else {
        setLocalKeys(keys);
        saveNavTabKeys(keys);
      }
    },
    [tabKeys, onChangeTabKeys]
  );

  const activeKey = useMemo(() => {
    if (showQuiz) return "quiz";
    if (showGoals) return "goals";
    if (showTodo) return "todo";
    if (mobileNavTab === "account") return "account";
    if (mobileNavTab === "words") return "words";
    if (mobileNavTab === "add") return "add";
    if (mobileNavTab === "more") return "more";
    return "words";
  }, [mobileNavTab, showQuiz, showGoals, showTodo]);

  const clickHandlers = useMemo(
    () => ({
      words: () => {
        setMobileNavTab("words");
        try {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (_) {}
      },
      quiz: () => {
        setMobileNavTab("quiz");
        onOpenQuiz?.();
      },
      goals: () => {
        setMobileNavTab("goals");
        onOpenGoals?.();
      },
      todo: () => {
        setMobileNavTab("todo");
        onOpenTodo?.();
      },
      account: () => {
        setMobileNavTab("account");
        onOpenAccount?.();
      },
      add: () => {
        setMobileNavTab("add");
        onOpenAdd?.();
      },
      more: () => {
        setMobileNavTab("more");
        onOpenMore?.();
      },
    }),
    [setMobileNavTab, onOpenQuiz, onOpenGoals, onOpenTodo, onOpenAccount, onOpenAdd, onOpenMore]
  );

  const tabs = useMemo(() => {
    return tabKeys
      .map((key) => {
        const meta = ALL_NAV_ITEMS.find((i) => i.key === key);
        if (!meta) return null;
        return {
          key: meta.key,
          label: tr(isAr, meta.labelEn, meta.labelAr),
          onClick: clickHandlers[meta.key],
          onContextMenu:
            meta.key === "quiz"
              ? (e) => {
                  e.preventDefault();
                  setMobileNavTab("quiz");
                  onOpenDueQuiz?.();
                }
              : undefined,
          icon:
            meta.key === "quiz" ? (
              <span className="mobile-nav-icon-wrap">
                {meta.icon}
                {dueCountMobile > 0 && (
                  <span className="mobile-nav-badge">{dueCountMobile > 9 ? "9+" : dueCountMobile}</span>
                )}
              </span>
            ) : (
              meta.icon
            ),
        };
      })
      .filter(Boolean);
  }, [tabKeys, isAr, clickHandlers, dueCountMobile, setMobileNavTab, onOpenDueQuiz]);

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.key === activeKey));

  useEffect(() => {
    function measure() {
      const list = listRef.current;
      const el = itemRefs.current[activeIndex];
      if (!list || !el) return;
      const lr = list.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const size = Math.max(52, Math.min(er.width + 8, er.height + 10));
      const x = er.left - lr.left + er.width / 2 - size / 2;
      setLight({ x, w: size, ready: true });
    }
    measure();
    const t = setTimeout(measure, 40);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [activeIndex, isAr, tabs.length, editMode]);

  function moveTab(index, dir) {
    const next = [...tabKeys];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setTabKeys(next);
  }

  function removeTab(key) {
    if (tabKeys.length <= 2) return;
    setTabKeys(tabKeys.filter((k) => k !== key));
  }

  function addTab(key) {
    if (tabKeys.includes(key)) return;
    if (tabKeys.length >= 6) return;
    setTabKeys([...tabKeys, key]);
  }

  const unused = ALL_NAV_ITEMS.filter((i) => !tabKeys.includes(i.key));

  return (
    <nav
      className="mobile-bottom-nav arc-nav"
      aria-label={tr(isAr, "Main navigation", "التنقل الرئيسي")}
      style={{ position: "relative" }}
    >
      {editMode && (
        <div
          className="nav-customize-panel"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 8,
            right: 8,
            marginBottom: 8,
            padding: 12,
            borderRadius: 16,
            background: "var(--card)",
            border: "1px solid rgba(var(--border-rgb),0.14)",
            boxShadow: "0 12px 32px -12px rgba(0,0,0,0.35)",
            zIndex: 20,
            maxHeight: "50vh",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "var(--ink)" }}>
            {tr(isAr, "Customize navigation bar", "تخصيص شريط التنقل")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-strong)", marginBottom: 10 }}>
            {tr(isAr, "Reorder or remove items. Add from the list below.", "رتّب أو احذف العناصر. أضف من القائمة تحت.")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tabs.map((t, i) => (
              <div
                key={t.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "var(--input-bg)",
                  border: "1px solid rgba(var(--border-rgb),0.1)",
                }}
              >
                <span style={{ color: "var(--icon-muted)" }}>{t.icon}</span>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{t.label}</span>
                <button type="button" onClick={() => moveTab(i, -1)} disabled={i === 0} aria-label="Up"
                  style={{ border: "none", background: "transparent", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1, fontSize: 16, padding: 4 }}>↑</button>
                <button type="button" onClick={() => moveTab(i, 1)} disabled={i === tabs.length - 1} aria-label="Down"
                  style={{ border: "none", background: "transparent", cursor: i === tabs.length - 1 ? "default" : "pointer", opacity: i === tabs.length - 1 ? 0.3 : 1, fontSize: 16, padding: 4 }}>↓</button>
                <button type="button" onClick={() => removeTab(t.key)} disabled={tabs.length <= 2} aria-label="Remove"
                  style={{ border: "none", background: "transparent", cursor: tabs.length <= 2 ? "default" : "pointer", color: "var(--danger)", opacity: tabs.length <= 2 ? 0.3 : 1, fontSize: 14, padding: 4, fontWeight: 700 }}>✕</button>
              </div>
            ))}
          </div>
          {unused.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-strong)", margin: "12px 0 6px" }}>
                {tr(isAr, "Add item", "إضافة عنصر")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {unused.map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    onClick={() => addTab(u.key)}
                    disabled={tabKeys.length >= 6}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 12px",
                      borderRadius: 999,
                      border: "1px dashed rgba(var(--border-rgb),0.25)",
                      background: "var(--input-bg)",
                      color: "var(--ink)",
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: tabKeys.length >= 6 ? "default" : "pointer",
                      opacity: tabKeys.length >= 6 ? 0.5 : 1,
                    }}
                  >
                    {u.icon}
                    {tr(isAr, u.labelEn, u.labelAr)}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setEditMode(false)}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "10px 14px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, var(--accent-1), var(--accent-2))",
              color: "var(--on-accent, #fff)",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {tr(isAr, "Done", "تم")}
          </button>
        </div>
      )}

      <div className="arc-nav-bar" ref={listRef} role="tablist">
        <span
          className={"arc-nav-light" + (light.ready ? " is-ready" : "")}
          style={{
            transform: `translate3d(${light.x}px, -50%, 0)`,
            width: light.w,
            height: light.w,
          }}
          aria-hidden
        />
        {tabs.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeKey === t.key}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={
              "mobile-bottom-nav-item arc-nav-item" +
              (activeKey === t.key ? " is-active" : "")
            }
            onClick={editMode ? undefined : t.onClick}
            onContextMenu={editMode ? undefined : t.onContextMenu}
            title={
              t.key === "quiz"
                ? tr(isAr, "Tap: quiz · Long-press: due only", "ضغط: اختبار · ضغطة طويلة: المستحق فقط")
                : undefined
            }
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="mobile-bottom-nav-item arc-nav-item"
          onClick={() => setEditMode((v) => !v)}
          aria-label={tr(isAr, "Customize nav bar", "تخصيص شريط التنقل")}
          title={tr(isAr, "Customize nav bar", "تخصيص شريط التنقل")}
          style={{ flex: "0 0 auto", minWidth: 40, opacity: 0.7 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
