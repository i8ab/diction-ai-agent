import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { tr } from "../lib/config/i18n";
import { useHistoryBackClose, haptic } from "../lib/utils/useModalDismiss";
import { INK, PAPER, CARD, BRASS, errorStyle } from "../lib/config/theme";
import { getSpeechRecognitionCtor, recognizeSpeech, loadArDialect, loadEnAccent, enAccentLang } from "../lib/utils/speech";
import { isSrsDue } from "../lib/utils/quizHelpers";
import { SearchIcon, PlusIcon, XIcon, CheckIcon, WifiOffIcon, UndoIcon, ClockIcon, MicIcon, BookIcon } from "./common/Icons";
import { buildSearchSuggestions, filterSectionEntries, groupEntriesByLetter } from "../lib/utils/entryListUtils";
import { exportEntriesAsCsv, exportEntriesAsAnkiTsv, downloadTextFile } from "../lib/utils/csvUtils";
import {
  addEntry,
  editEntry,
  deleteEntry,
  undoDeleteEntry,
  importEntriesFromCsv,
} from "../lib/state/entryMutations";
import { SECTIONS } from "../lib/config/sections";
import {
  createAcademicUnit,
  renameAcademicUnit,
  deleteAcademicUnit,
} from "../lib/state/academicUnits";
import MinecraftAchievementToast from "./common/MinecraftAchievementToast";
import HeaderMenu from "./layout/HeaderMenu";
import BrandMark from "./common/BrandMark";
import AvatarWithFrame from "./common/AvatarWithFrame";
import ToolsMenu from "./layout/ToolsMenu";
import ReminderBanner from "./layout/ReminderBanner";
import BackupReminderBanner from "./layout/BackupReminderBanner";
import ExamBanner from "./layout/ExamBanner";
import SiteBanner from "./layout/SiteBanner";
import WordListPanel from "./layout/WordListPanel";
import EntryFiltersBar from "./layout/EntryFiltersBar";
import AccountRequestsModal, { AccountRequestsButton } from "./layout/AccountRequestsModal";
import MobileBottomNav from "./layout/MobileBottomNav";
import MainViewOverlays from "./layout/MainViewOverlays";
import ToolShell from "./layout/ToolShell";
import { loadFocusMode, saveFocusMode } from "../lib/state/goals";
import { loadXp, snapshotProgress } from "../lib/state/xp";
import { loadWordNotes } from "../lib/state/wordNotes";

import { useToolViews } from "../lib/hooks/useToolViews";
import { useEntrySearch } from "../lib/hooks/useEntrySearch";
import { useStudyShortcuts } from "../lib/hooks/useStudyShortcuts";
import { useListPagination } from "../lib/hooks/useListPagination";
import WelcomeOnboardingModal, { hasSeenWelcome, markWelcomeSeen } from "./modals/WelcomeOnboardingModal";

export default function MainView({
  name, isAdmin, entries, entriesLoaded, loadError, isOffline, offlineCachedAt, section, onChangeSection, query, setQuery,
  showAdd, onOpenAdd, onCloseAdd, persistEntries, saveError, onLogout,
  accounts, accountCode, logs, onClearLogs, studiedIds, studiedAt, onToggleStudied, favoriteIds, onToggleFavorite, showAccount, onOpenAccount, onCloseAccount, onUpdateOwnAccount,
  srsBox, srsDueAt, srsStats = {}, wordPriorities = {}, onSetWordPriority, quizHistory, onRecordSrsAnswer, onSaveQuizResult, onDictationRoundFinished,
  siteBanner, onPersistSiteBanner,
  examConfig, onPersistExamConfig,
  academicUnits = [], activeUnitId = null, onChangeActiveUnitId, onPersistAcademicUnits,
  showAdmin, onOpenAdmin, onCloseAdmin, onAdminAddAccount, onAdminEditAccount, onAdminDeleteAccount, onApproveRequest, onRejectRequest,
  toast, showToast, theme, onToggleTheme, onChangeTheme, accentTheme, onChangeAccent,
  appIsAr, appLang = "en", onToggleAppLang, onChangeAppLang,
  deviceMode = null, onChangeDeviceMode, uiScale = 1, onChangeUiScale,
  sessionStart,
  remindersOn, remindersBusy, onEnableReminders, onDisableReminders, onTestReminder,
  reminderTitle, onChangeReminderTitle,
  reminderMessage, onChangeReminderMessage,
  vaultAccounts = [], mainAccountCode = "",
  onSwitchAccount, onSetMainAccount, onUnlinkVaultAccount, onLogoutAll, onLinkAccount,
}) {
  const cfg = SECTIONS[section] || SECTIONS["en-ar"];
  const isAr = section === "ar-ar";
  const isAcademic = section === "academic";
  // Always resolve a concrete unit for Academic (never add/filter with null)
  const resolvedUnitId = useMemo(() => {
    if (!isAcademic) return null;
    const list = academicUnits || [];
    if (activeUnitId && list.some((u) => u.id === activeUnitId)) return activeUnitId;
    return list[0]?.id || null;
  }, [isAcademic, activeUnitId, academicUnits]);
  const sectionEntries = useMemo(() => {
    const base = entries.filter((e) => e.section === section);
    if (!isAcademic) return base;
    if (!resolvedUnitId) return base;
    // Show words tagged for this unit OR legacy words with no unitId yet
    return base.filter((e) => {
      const uid = e.unitId || null;
      return !uid || uid === resolvedUnitId;
    });
  }, [entries, section, isAcademic, resolvedUnitId]);
  const allAcademicEntries = useMemo(
    () => (isAcademic ? entries.filter((e) => e.section === "academic") : []),
    [entries, isAcademic]
  );
  // Keep activeUnitId in sync when Academic is open
  useEffect(() => {
    if (!isAcademic) return;
    if (!resolvedUnitId) return;
    if (activeUnitId !== resolvedUnitId && onChangeActiveUnitId) {
      onChangeActiveUnitId(resolvedUnitId);
    }
  }, [isAcademic, resolvedUnitId, activeUnitId, onChangeActiveUnitId]);
  const studiedCount = useMemo(() => sectionEntries.filter((e) => studiedIds.has(e.id)).length, [sectionEntries, studiedIds]);
  const notStudiedCount = sectionEntries.length - studiedCount;
  const dueCountMobile = useMemo(
    () => sectionEntries.filter((e) => studiedIds.has(e.id) && isSrsDue(e.id, srsDueAt)).length,
    [sectionEntries, studiedIds, srsDueAt]
  );
  const studiedPct = sectionEntries.length ? (studiedCount / sectionEntries.length) * 100 : 0;
  const notStudiedPct = 100 - studiedPct;
  const accountNameByCode = useMemo(() => Object.fromEntries(accounts.map((a) => [a.code, a.name])), [accounts]);
  // "preparing": button pressed but the mic isn't armed yet (permission /
  // hardware startup can take a noticeable beat) — talking during this
  // window is silently lost. "listening": recognition's own onstart fired,
  // so it's actually capturing audio. Waiting for onstart before treating
  // it as "listening" (instead of flipping the flag at click time) fixes
  // attempts getting dropped because the user spoke a moment too early.
  const [voiceMicState, setVoiceMicState] = useState("idle"); // idle | preparing | listening
  const [voiceMicLevel, setVoiceMicLevel] = useState(0);
  const voiceListening = voiceMicState !== "idle";
  const speechSupported = useMemo(() => !!getSpeechRecognitionCtor(), []);
  const handleVoiceSearch = useCallback(async () => {
    if (!speechSupported || voiceListening) return;
    setVoiceMicState("preparing");
    setVoiceMicLevel(0);
    try {
      const lang = isAr ? loadArDialect() : enAccentLang(loadEnAccent());
      const text = await recognizeSpeech(lang, {
        onStart: () => setVoiceMicState("listening"),
        onLevel: (lvl) => setVoiceMicLevel(lvl),
        durationMs: 3200,
      });
      if (text) {
        setQuery(text);
        setShowSuggestions(true);
      } else {
        showToast(tr(isAr, "Didn't catch that — try again.", "معرفتش أسمع صح — جرّب تاني."));
      }
    } catch (e) {
      showToast(tr(isAr, "Didn't catch that — try again.", "معرفتش أسمع صح — جرّب تاني."));
    } finally {
      setVoiceMicLevel(0);
      setVoiceMicState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechSupported, voiceListening, isAr]);
  const [studyFilter, setStudyFilter] = useState("all"); // "all" | "studied" | "not-studied" | "favorites" | "due"
  /* PAGINATION — with word lists that grow past a hundred or so entries,
     rendering every EntryCard (each with its own DOM subtree, hover
     handlers, speak buttons, etc.) at once is what makes the page feel
     sluggish while scrolling. Instead of pulling in a virtualization
     library, we render entries in capped batches ("pages") and grow the
     batch as the user scrolls near the bottom (classic infinite-scroll),
     or jump straight to a bigger batch when they use the A-Z sidebar to
     jump to a letter that isn't rendered yet. This keeps the mounted node
     count bounded regardless of how many words are in the dictionary. */
  const [editingEntry, setEditingEntry] = useState(null);
  const [zoomEntry, setZoomEntry] = useState(null);
  const [zoomAlreadyExists, setZoomAlreadyExists] = useState(false);
  // When add hits a duplicate: show message + "Go to it" — do NOT auto-open the card.
  const [dupNotice, setDupNotice] = useState(null); // { entry } | null
  const [showQuiz, setShowQuiz] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileNavTab, setMobileNavTab] = useState("words");


  const [quizDueOnly, setQuizDueOnly] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showWordLists, setShowWordLists] = useState(false);
  const [showChallenges, setShowChallenges] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [posFilter, setPosFilter] = useState("all"); // all | noun | verb | ...
  const [dateFilter, setDateFilter] = useState("all"); // all | today | week | month
  const [sortKey, setSortKey] = useState("alpha"); // alpha | newest | oldest | weak
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const {
    showTimer, setShowTimer, timerBubble, setTimerBubble, openTimer, closeTimer,
    showCalendar, setShowCalendar, calendarBubble, setCalendarBubble, openCalendar, closeCalendar,
    showTodo, setShowTodo, todoBubble, setTodoBubble, openTodo, closeTodo,
    showGoals, setShowGoals, goalsBubble, setGoalsBubble, openGoals, closeGoals,
    toolFullscreen,
  } = useToolViews();
  const [focusMode, setFocusMode] = useState(() => loadFocusMode());
  const [nightStudy, setNightStudy] = useState(() => {
    try { return localStorage.getItem("twoTongues.nightStudy") === "1"; } catch (_) { return false; }
  });
  const [showSmartCards, setShowSmartCards] = useState(false);
  const [showConversation, setShowConversation] = useState(false);
  const [showLevels, setShowLevels] = useState(false);
  const [showProgressCompare, setShowProgressCompare] = useState(false);
  const [showTextExtract, setShowTextExtract] = useState(false);
  const [showAiPdfExtract, setShowAiPdfExtract] = useState(false);
  const [showQuickReview, setShowQuickReview] = useState(false);
  const [showWeaknessReview, setShowWeaknessReview] = useState(false);
  const [showListeningLoop, setShowListeningLoop] = useState(false);
  const [showSentencePractice, setShowSentencePractice] = useState(false);
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  const [showExamMode, setShowExamMode] = useState(false);
  const [showExamSettings, setShowExamSettings] = useState(false);
  const [showInfoGuide, setShowInfoGuide] = useState(false);

  // System back button closes the top-most overlay on mobile instead of leaving the site.
  // NOTE: showAdd is managed by App.jsx history (openAddModal/closeAddModal) — do NOT
  // also hook it here. A second pushState caused: close → history.back → popstate
  // restored showAdd:true → Add modal reopened in a loop with the word zoom card.
  useHistoryBackClose(showQuiz, () => { setShowQuiz(false); setQuizDueOnly(false); });
  useHistoryBackClose(showExamMode, () => setShowExamMode(false));
  useHistoryBackClose(!!zoomEntry, () => { setZoomEntry(null); setZoomAlreadyExists(false); });
  useHistoryBackClose(showGoals, closeGoals);
  useHistoryBackClose(showTodo, closeTodo);
  useHistoryBackClose(showInfoGuide, () => setShowInfoGuide(false));
  useHistoryBackClose(showWeaknessReview, () => setShowWeaknessReview(false));
  useHistoryBackClose(showListeningLoop, () => setShowListeningLoop(false));
  useHistoryBackClose(showSentencePractice, () => setShowSentencePractice(false));
  useHistoryBackClose(showWeeklyReport, () => setShowWeeklyReport(false));

  // Welcome onboarding: once per account, or forced via sessionStorage for testing
  useEffect(() => {
    if (!accountCode || accountCode === "guest") return;
    let force = false;
    try {
      force = sessionStorage.getItem("twoTongues.forceWelcome") === "1";
    } catch (_) {}
    if (!force && hasSeenWelcome(accountCode)) return;
    if (force) {
      try { sessionStorage.removeItem("twoTongues.forceWelcome"); } catch (_) {}
    }
    const t = setTimeout(() => setShowWelcome(true), 500);
    return () => clearTimeout(t);
  }, [accountCode]);


  const [showDictation, setShowDictation] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showRandomWord, setShowRandomWord] = useState(false);
  /** Pending level-up celebration; deferred while quiz/exam/dictation/etc. is open. */
  const [pendingLevelUp, setPendingLevelUp] = useState(null);
  const [wordNotes, setWordNotes] = useState(() => loadWordNotes(accountCode));
  const searchInputRef = useRef(null);

  useEffect(() => { setWordNotes(loadWordNotes(accountCode)); }, [accountCode]);
  useEffect(() => { saveFocusMode(focusMode); }, [focusMode]);

  // Level-up celebration: queue while a focus activity is open, show after it closes.
  useEffect(() => {
    function onLevelUp(e) {
      const detail = e?.detail;
      if (!detail || !detail.toLevel) return;
      setPendingLevelUp(detail);
    }
    window.addEventListener("twotongues:levelup", onLevelUp);
    return () => window.removeEventListener("twotongues:levelup", onLevelUp);
  }, []);

  // Minecraft achievement toast click → open Achievements modal
  useEffect(() => {
    function onOpenAchievements() {
      setShowAchievements(true);
    }
    window.addEventListener("twotongues:open-achievements", onOpenAchievements);
    return () => window.removeEventListener("twotongues:open-achievements", onOpenAchievements);
  }, []);

  // Prefetch lazy modal chunks in idle time so the *first* open feels instant
  // (second open was already fast because the chunk was cached).
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Warm the most-used practice modals; browser will cache the modules.
      const warm = [
        () => import("./modals/DictationModal"),
        () => import("./modals/QuizModal"),
        () => import("./modals/ExamModeModal"),
        () => import("./modals/FlashcardsModal"),
        () => import("./modals/QuickReviewModal"),
        () => import("./modals/RandomWordModal"),
        () => import("./modals/SmartCardsModal"),
        () => import("./modals/StatsModal"),
      ];
      warm.forEach((fn, i) => {
        setTimeout(() => {
          if (!cancelled) fn().catch(() => {});
        }, 400 + i * 180);
      });
    };
    let idleId;
    if (typeof window !== "undefined" && window.requestIdleCallback) {
      idleId = window.requestIdleCallback(run, { timeout: 3500 });
    } else {
      idleId = setTimeout(run, 1800);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && window.cancelIdleCallback && typeof idleId === "number") {
        try { window.cancelIdleCallback(idleId); } catch (_) {}
      } else {
        clearTimeout(idleId);
      }
    };
  }, []);

  const blockingActivity =
    showQuiz ||
    showExamMode ||
    showDictation ||
    showFlashcards ||
    showSmartCards ||
    showConversation ||
    showTextExtract ||
    showAiPdfExtract ||
    showQuickReview;

  const showLevelUpNow = pendingLevelUp && !blockingActivity;
  useEffect(() => {
    try { document.documentElement.setAttribute("data-focus-mode", focusMode ? "1" : "0"); } catch (_) {}
  }, [focusMode]);
  useEffect(() => {
    try {
      localStorage.setItem("twoTongues.nightStudy", nightStudy ? "1" : "0");
      document.documentElement.setAttribute("data-night-study", nightStudy ? "1" : "0");
    } catch (_) {}
  }, [nightStudy]);

  useStudyShortcuts({
    showQuickReview,
    setShowQuickReview,
    focusMode,
    setFocusMode,
    onOpenAdd,
    searchInputRef,
    setShowQuiz,
    setShowTodo,
    setTodoBubble,
  });



  const [undoDelete, setUndoDelete] = useState(null); // { entry, prevEntries } — cleared after UNDO_DELETE_MS or on undo
  const undoTimerRef = useRef(null);
  const importInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => () => clearTimeout(undoTimerRef.current), []);

  const suggestions = useMemo(
    () => buildSearchSuggestions(sectionEntries, query, section, 6),
    [query, sectionEntries, section]
  );

  const {
    showSuggestions, setShowSuggestions,
    activeIndex, setActiveIndex,
    showHistory, setShowHistory,
    searchHistory,
    commitSearchTerm, selectSuggestion, selectHistoryTerm,
    handleRemoveHistoryTerm, handleClearHistory, handleSearchKeyDown,
  } = useEntrySearch({ section, query, setQuery, suggestions });

  const filtered = useMemo(
    () =>
      filterSectionEntries({
        sectionEntries,
        query,
        studyFilter,
        studiedIds,
        favoriteIds,
        srsDueAt,
        srsBox,
        posFilter,
        dateFilter,
        sortKey,
        wordPriorities,
      }),
    [sectionEntries, query, studyFilter, studiedIds, favoriteIds, srsDueAt, srsBox, posFilter, dateFilter, sortKey, wordPriorities]
  );

  // Full grouping (all matching entries) — used for the A-Z sidebar so it
  // always shows every letter that has words, even ones not rendered yet.
  const grouped = useMemo(
    () => groupEntriesByLetter(filtered, section),
    [filtered, section]
  );

  // Flat, fully-sorted list in the exact order the letters render (A, B, C…
  // each internally alphabetical) — this is what pagination slices.
  const sortedLetters = useMemo(() => cfg.letters.filter((l) => grouped[l]), [cfg.letters, grouped]);
  const flatSorted = useMemo(() => {
    const out = [];
    for (const l of sortedLetters) out.push(...grouped[l]);
    return out;
  }, [sortedLetters, grouped]);

  const {
    visibleCount, setVisibleCount, visibleGrouped, hasMore, loadMoreRef, loadMore, pageSize: PAGE_SIZE,
  } = useListPagination({
    flatSorted,
    sortedLetters,
    grouped,
    resetDeps: [query, studyFilter, section, posFilter, dateFilter, sortKey],
  });

  const availableLetters = useMemo(() => new Set(Object.keys(grouped)), [grouped]);
  function jumpTo(letter, letterRefs) {
    const refs = letterRefs && letterRefs.current ? letterRefs.current : {};
    if (!visibleGrouped[letter] && grouped[letter]) {
      let count = 0;
      for (const l of sortedLetters) {
        count += grouped[l].length;
        if (l === letter) break;
      }
      setVisibleCount((c) => Math.max(c, count));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = refs[letter];
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }));
      return;
    }
    const el = refs[letter];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleAdd(newEntry) {
    return addEntry({
      newEntry,
      section,
      sectionEntries,
      entries,
      accountCode,
      name,
      cfg,
      appIsAr,
      persistEntries,
      onCloseAdd,
      showToast,
      unitId: isAcademic ? resolvedUnitId : null,
    });
  }
  const handleDelete = useCallback(async (id) => {
    await deleteEntry({
      id,
      entries,
      persistEntries,
      name,
      accountCode,
      setUndoDelete,
      undoTimerRef,
    });
  }, [entries, persistEntries, name, accountCode]);

  const handleEditRequest = useCallback((id) => {
    const target = entries.find((e) => e.id === id);
    if (target) setEditingEntry(target);
  }, [entries]);

  const handleZoomRequest = useCallback((id) => {
    const target = entries.find((e) => e.id === id);
    if (target) {
      setZoomAlreadyExists(false);
      setZoomEntry(target);
    }
  }, [entries]);

  const handleToggleStudiedById = useCallback((id) => { haptic(12); onToggleStudied(id); }, [onToggleStudied]);
  const handleToggleFavoriteById = useCallback((id) => { onToggleFavorite(id); }, [onToggleFavorite]);
  const handleCyclePriority = useCallback((id) => {
    if (typeof onSetWordPriority === "function") onSetWordPriority(id);
  }, [onSetWordPriority]);
  async function handleUndoDelete() {
    await undoDeleteEntry({
      undoDelete,
      setUndoDelete,
      undoTimerRef,
      name,
      accountCode,
      cfg,
      persistEntries,
    });
  }
  async function handleImportCsv(file) {
    await importEntriesFromCsv({
      file,
      section,
      sectionEntries,
      accountCode,
      name,
      cfg,
      isAr,
      persistEntries,
      showToast,
      setImporting,
    });
  }
  async function handleEdit(id, updates) {
    await editEntry({
      id,
      updates,
      entries,
      sectionEntries,
      section,
      accountCode,
      name,
      appIsAr,
      persistEntries,
      showToast,
      setEditingEntry,
    });
  }

  return (
    <>
    {/* Hide dictionary while the full timer/calendar page is open; show it again under the floating bubble. */}
    <div
      dir={cfg.dir}
      style={{
        minHeight: "100dvh",
        background: PAPER,
        fontFamily: "'Source Sans 3', sans-serif",
        /* لا نضع overflow هنا — overflow-x:hidden على عنصر وسيط يكسر position:sticky لقائمة الحروف */
        maxWidth: "100%",
        display: toolFullscreen ? "none" : undefined,
      }}
      aria-hidden={toolFullscreen ? true : undefined}
    >
      {!focusMode && <SiteBanner banner={siteBanner} isAr={appIsAr} />}
      <header style={{ borderBottom: "1px solid rgba(var(--border-rgb),0.15)", background: PAPER, position: "sticky", top: 0, zIndex: 1000 }}>
        <div className="app-container" style={{ margin: "0 auto", padding: "clamp(12px, 2.5vw, 20px) clamp(12px, 3vw, 24px) 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <BrandMark size="sm" isAr={appIsAr} editable />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AvatarWithFrame
                accountCode={accountCode}
                avatarUrl={((accounts || []).find((a) => a.code === accountCode) || {}).avatar}
                name={name}
                size={40}
                onClick={onOpenAccount}
                title={tr(appIsAr, "My account", "حسابي")}
              />
              {isAdmin && (
                <>
                  <AccountRequestsButton
                    pendingCount={(accounts || []).filter((a) => a.status === "pending").length}
                    isAr={appIsAr}
                    onClick={() => setRequestsOpen(true)}
                  />
                  <AccountRequestsModal
                    open={requestsOpen}
                    onClose={() => setRequestsOpen(false)}
                    pending={(accounts || []).filter((a) => a.status === "pending")}
                    isAr={appIsAr}
                    onApproveRequest={onApproveRequest}
                    onRejectRequest={onRejectRequest}
                  />
                </>
              )}
              <HeaderMenu theme={theme} onToggleTheme={onToggleTheme} onChangeTheme={onChangeTheme} isAdmin={isAdmin}
                onOpenAccount={onOpenAccount} onOpenAdmin={onOpenAdmin} onLogout={onLogout} isAr={appIsAr}
                vaultAccounts={vaultAccounts} mainAccountCode={mainAccountCode} accountCode={accountCode}
                onSwitchAccount={onSwitchAccount} onSetMainAccount={onSetMainAccount}
                onUnlinkVaultAccount={onUnlinkVaultAccount} onLogoutAll={onLogoutAll} onLinkAccount={onLinkAccount}
                appLang={appLang} onChangeAppLang={onChangeAppLang} deviceMode={deviceMode} onChangeDeviceMode={onChangeDeviceMode} uiScale={uiScale} onChangeUiScale={onChangeUiScale}
                accentTheme={accentTheme} onChangeAccent={onChangeAccent}
                remindersOn={remindersOn} remindersBusy={remindersBusy} onEnableReminders={onEnableReminders} onDisableReminders={onDisableReminders} onTestReminder={onTestReminder}
                reminderTitle={reminderTitle} onChangeReminderTitle={onChangeReminderTitle}
                reminderMessage={reminderMessage} onChangeReminderMessage={onChangeReminderMessage}
                pendingAccounts={(accounts || []).filter((a) => a.status === "pending")}
                onApproveRequest={onApproveRequest}
                onRejectRequest={onRejectRequest}
                siteBanner={siteBanner}
                onPersistSiteBanner={onPersistSiteBanner}
                onOpenExamSettings={isAdmin ? () => setShowExamSettings(true) : undefined}
                myAccountCode={accountCode}
              
                focusMode={focusMode}
                onToggleFocus={() => setFocusMode((v) => !v)}
                onOpenInfo={() => setShowInfoGuide(true)}
                onOpenAchievements={() => setShowAchievements(true)}
              />
              <ToolsMenu
              accent={cfg.accent}
              onLeaderboard={() => setShowLeaderboard(true)}
              onStats={() => setShowStats(true)}
              onWeeklyReport={() => setShowWeeklyReport(true)}
              onQuiz={() => setShowQuiz(true)}
              onExamMode={() => setShowExamMode(true)}
              onFlashcards={() => setShowFlashcards(true)}
              onTimer={openTimer}
              onCalendar={openCalendar}
              onTodo={openTodo}
              onGoals={openGoals}
              onQuickReview={() => setShowQuickReview(true)}
              onWeaknessReview={() => setShowWeaknessReview(true)}
              onListeningLoop={() => setShowListeningLoop(true)}
              onSentencePractice={() => setShowSentencePractice(true)}
              onDictation={() => setShowDictation(true)}
              onAchievements={() => setShowAchievements(true)}
              onRandomWord={() => setShowRandomWord(true)}
              onExport={() => {
                const list = filtered.length ? filtered : sectionEntries;
                const csv = exportEntriesAsCsv(list);
                downloadTextFile(`dictionary-${section}.csv`, csv, "text/csv;charset=utf-8");
              }}
              onExportAnki={() => {
                const list = filtered.length ? filtered : sectionEntries;
                const tsv = exportEntriesAsAnkiTsv(list);
                downloadTextFile(`anki-${section}.txt`, tsv, "text/tab-separated-values;charset=utf-8");
              }}
              onDashboard={() => setShowDashboard(true)}
              onWordLists={() => setShowWordLists(true)}
              onChallenges={() => setShowChallenges(true)}
              focusMode={focusMode}
              onToggleFocus={() => setFocusMode((v) => !v)}
              onSmartCards={() => setShowSmartCards(true)}
              onConversation={() => setShowConversation(true)}
              onLevels={() => setShowLevels(true)}
              onProgressCompare={() => setShowProgressCompare(true)}
              onTextExtract={() => setShowTextExtract(true)}
              nightStudy={nightStudy}
              onToggleNightStudy={() => setNightStudy((v) => !v)}
              exportDisabled={sectionEntries.length === 0}
              onImport={() => importInputRef.current && importInputRef.current.click()}
              importing={importing}
              isAr={appIsAr}
            />
            </div>
          </div>
          <div className="section-tabs-row" style={{ display: "flex", gap: 8, marginTop: 16, width: "100%" }}>
            {Object.entries(SECTIONS).map(([key, s]) => {
              const active = key === section;
              return (
                <button key={key} onClick={() => onChangeSection(key)}
                  className="section-tab" style={{ flex: "1 1 0", minWidth: 0, padding: "9px 16px", fontSize: 14, fontWeight: 600, color: active ? s.accent : "var(--icon-muted)", background: active ? CARD : "transparent", border: "1px solid rgba(var(--border-rgb),0.15)", borderBottom: active ? `1px solid ${CARD}` : "1px solid rgba(var(--border-rgb),0.15)", borderRadius: "8px 8px 0 0", marginBottom: -1, cursor: "pointer", transform: active ? "translateY(-1px)" : "none", textAlign: "center", whiteSpace: "nowrap" }}>
                  {s.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="app-container" style={{ margin: "0 auto", padding: "clamp(12px, 2.5vw, 20px) clamp(12px, 3vw, 24px) 0" }}>
        {isAcademic && (
          <div
            className="academic-unit-bar"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginBottom: 14,
              padding: "10px 12px",
              background: CARD,
              border: "1px solid rgba(var(--border-rgb),0.15)",
              borderRadius: 12,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted-strong)", letterSpacing: "0.04em", textTransform: "uppercase", marginInlineEnd: 4 }}>
              {tr(appIsAr, "Units", "الوحدات")}
            </span>
            {(academicUnits || []).map((u) => {
              const active = u.id === resolvedUnitId;
              const count = allAcademicEntries.filter((e) => (e.unitId || null) === u.id).length;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onChangeActiveUnitId && onChangeActiveUnitId(u.id)}
                  style={{
                    padding: "7px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 999,
                    border: active ? `1.5px solid ${cfg.accent}` : "1px solid rgba(var(--border-rgb),0.2)",
                    background: active ? cfg.accentSoft : "transparent",
                    color: active ? cfg.accent : "var(--icon-muted)",
                    cursor: "pointer",
                  }}
                >
                  {u.name}
                  <span style={{ marginInlineStart: 6, opacity: 0.75, fontSize: 11 }}>{count}</span>
                </button>
              );
            })}
            {isAdmin && typeof onPersistAcademicUnits === "function" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt(tr(appIsAr, "New unit name", "اسم الوحدة الجديدة"));
                    if (!name || !name.trim()) return;
                    const next = createAcademicUnit(academicUnits, name.trim());
                    onPersistAcademicUnits(next);
                    const created = next[next.length - 1];
                    if (created) onChangeActiveUnitId && onChangeActiveUnitId(created.id);
                  }}
                  style={{
                    padding: "7px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    borderRadius: 999,
                    border: "1px dashed rgba(var(--border-rgb),0.35)",
                    background: "transparent",
                    color: cfg.accent,
                    cursor: "pointer",
                  }}
                >
                  + {tr(appIsAr, "Add unit", "إضافة وحدة")}
                </button>
                {activeUnitId && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = (academicUnits || []).find((u) => u.id === activeUnitId);
                        if (!cur) return;
                        const name = window.prompt(tr(appIsAr, "Rename unit", "إعادة تسمية الوحدة"), cur.name);
                        if (!name || !name.trim() || name.trim() === cur.name) return;
                        onPersistAcademicUnits(renameAcademicUnit(academicUnits, activeUnitId, name.trim()));
                      }}
                      style={{ padding: "7px 10px", fontSize: 12, fontWeight: 600, borderRadius: 999, border: "none", background: "var(--input-bg)", color: "var(--icon-muted)", cursor: "pointer" }}
                    >
                      {tr(appIsAr, "Rename", "إعادة تسمية")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if ((academicUnits || []).length <= 1) {
                          showToast?.(tr(appIsAr, "Keep at least one unit.", "لازم تفضل وحدة واحدة على الأقل."));
                          return;
                        }
                        const cur = (academicUnits || []).find((u) => u.id === activeUnitId);
                        if (!cur) return;
                        if (!window.confirm(tr(appIsAr, `Delete "${cur.name}"? Words stay but lose this unit tag.`, `حذف «${cur.name}»؟ الكلمات هتفضل بس من غير الوحدة دي.`))) return;
                        const next = deleteAcademicUnit(academicUnits, activeUnitId);
                        onPersistAcademicUnits(next);
                        onChangeActiveUnitId && onChangeActiveUnitId(next[0]?.id || null);
                      }}
                      style={{ padding: "7px 10px", fontSize: 12, fontWeight: 600, borderRadius: 999, border: "none", background: "var(--danger-bg, rgba(220,50,50,0.12))", color: "var(--danger, #ff6b6b)", cursor: "pointer" }}
                    >
                      {tr(appIsAr, "Delete", "حذف")}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {!focusMode && (
          <div className="exam-banner-slot" style={{ marginBottom: 14 }}>
            <ExamBanner
              examConfig={examConfig}
              entries={sectionEntries}
              studiedIds={studiedIds}
              studiedAt={studiedAt}
              srsDueAt={srsDueAt}
              srsBox={srsBox}
              isAr={appIsAr}
              isAdmin={isAdmin}
              onOpenExamMode={() => setShowExamMode(true)}
              onOpenExamSettings={isAdmin ? () => setShowExamSettings(true) : undefined}
            />
          </div>
        )}
        <div className="toolbar-row mobile-sticky-search" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", position: "relative", zIndex: 50, marginBottom: 4 }}>
          <div className="toolbar-anim toolbar-search-wrap" style={{ position: "relative", flex: "1 1 240px", animationDelay: "0.02s", zIndex: 50 }}>
            <SearchIcon size={16} color="var(--icon-muted)" style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                setShowSuggestions(!!v.trim());
                setShowHistory(!v.trim() && searchHistory.length > 0);
              }}
              onFocus={() => {
                if (query.trim()) setShowSuggestions(true);
                else if (searchHistory.length > 0) setShowHistory(true);
              }}
              onBlur={() => setTimeout(() => { setShowSuggestions(false); setShowHistory(false); }, 120)}
              onKeyDown={handleSearchKeyDown}
              placeholder={tr(isAr, `Search ${cfg.shortLabel}…`, `بحث في ${cfg.shortLabel}…`)} dir={section === "ar-ar" ? "rtl" : "auto"}
              role="combobox" aria-autocomplete="list" aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="search-suggestions" aria-activedescendant={activeIndex >= 0 ? `search-suggestion-${activeIndex}` : undefined}
              autoComplete="off"
              className="toolbar-search-input"
              style={{ width: "100%", padding: "11px 12px", paddingInlineStart: 36, paddingInlineEnd: (query.trim() ? 68 : 0) + (speechSupported ? 38 : 12), fontSize: 15, border: "1px solid rgba(var(--border-rgb),0.2)", borderRadius: 12, background: "var(--input-bg)", color: INK }} />
            {!!query.trim() && (
              <button
                type="button"
                onClick={() => { setQuery(""); setShowSuggestions(false); setShowHistory(searchHistory.length > 0); searchInputRef.current?.focus?.(); }}
                aria-label={tr(isAr, "Clear search", "مسح البحث")}
                className="search-clear-btn"
                style={{ position: "absolute", insetInlineEnd: speechSupported ? 40 : 8, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, borderRadius: "50%", border: "none", background: "rgba(var(--border-rgb),0.12)", color: "var(--icon-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: 1, padding: 0 }}
              >×</button>
            )}
            {speechSupported && (
              <button type="button" onClick={handleVoiceSearch} disabled={voiceListening}
                title={voiceMicState === "listening" ? tr(isAr, "Listening — speak now", "بسمع دلوقتي — اتكلم") : tr(isAr, "Search by voice", "بحث صوتي")}
                aria-label={tr(isAr, "Search by voice", "بحث صوتي")}
                className={voiceMicState === "preparing" ? "voice-mic-active" : undefined}
                style={{ position: "absolute", insetInlineEnd: 8, top: "50%", transform: `translateY(-50%) scale(${voiceMicState === "listening" ? 1 + voiceMicLevel * 0.35 : 1})`, display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, border: "none", background: "none", color: voiceListening ? cfg.accent : "var(--icon-muted)", cursor: voiceListening ? "default" : "pointer", padding: 0, transition: "transform 80ms linear" }}>
                <MicIcon size={15} />
              </button>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul id="search-suggestions" role="listbox" dir={section === "ar-ar" ? "rtl" : "auto"}
                className="modal-card"
                style={{ listStyle: "none", margin: "4px 0 0", padding: 4, position: "absolute", top: "100%", insetInlineStart: 0, insetInlineEnd: 0, background: CARD, border: "1px solid rgba(var(--border-rgb),0.2)", borderRadius: 10, boxShadow: "0 10px 24px -10px rgba(0,0,0,0.3)", zIndex: 60, maxHeight: 260, overflowY: "auto" }}>
                {suggestions.map((s, i) => (
                  <li key={s.id} id={`search-suggestion-${i}`} role="option" aria-selected={i === activeIndex}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "7px 9px", borderRadius: 7, cursor: "pointer", background: i === activeIndex ? cfg.accentSoft : "transparent" }}>
                    <span dir={cfg.wordDir} style={{ fontFamily: cfg.wordFont, fontSize: 14, fontWeight: 600, color: INK }}>{s.word}</span>
                    <span dir={cfg.meaningDir} style={{ fontFamily: cfg.meaningFont, fontSize: 13, color: "var(--meaning)" }}>{s.meaning}</span>
                  </li>
                ))}
              </ul>
            )}
            {showHistory && !query.trim() && searchHistory.length > 0 && (
              <div dir={section === "ar-ar" ? "rtl" : "auto"}
                className="modal-card"
                style={{ margin: "4px 0 0", padding: 4, position: "absolute", top: "100%", insetInlineStart: 0, insetInlineEnd: 0, background: CARD, border: "1px solid rgba(var(--border-rgb),0.2)", borderRadius: 10, boxShadow: "0 10px 24px -10px rgba(0,0,0,0.3)", zIndex: 60, maxHeight: 260, overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 9px 3px", fontSize: 11, color: "var(--icon-muted)", fontWeight: 600 }}>
                  <span>{tr(isAr, "Recent searches", "عمليات بحث سابقة")}</span>
                  <button onMouseDown={(e) => { e.preventDefault(); handleClearHistory(); }}
                    style={{ background: "none", border: "none", color: "var(--icon-muted)", fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                    {tr(isAr, "Clear", "مسح الكل")}
                  </button>
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {searchHistory.map((term) => (
                    <li key={term}
                      onMouseDown={(e) => { e.preventDefault(); selectHistoryTerm(term); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 7, cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = cfg.accentSoft; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                      <ClockIcon size={14} color="var(--icon-muted)" style={{ flexShrink: 0 }} />
                      <span dir={cfg.wordDir} style={{ fontFamily: cfg.wordFont, fontSize: 14, color: INK, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{term}</span>
                      <button onMouseDown={(e) => handleRemoveHistoryTerm(e, term)}
                        aria-label={tr(isAr, "Remove", "إزالة")}
                        style={{ background: "none", border: "none", color: "var(--icon-muted)", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}>
                        <XIcon size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="toolbar-actions toolbar-anim" style={{ animationDelay: "0.04s" }}>
            <button onClick={onOpenAdd} className="btn-shine lift-hover toolbar-add-word" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600, color: "#fff", background: cfg.accent, border: "none", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
              <PlusIcon size={16} /> {tr(isAr, "Add word", "إضافة كلمة")}
            </button>
            
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                e.target.value = "";
                if (file) handleImportCsv(file);
              }}
            />
          </div>
        </div>
        {undoDelete && (
          <div role="status" className="modal-card"
            style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", background: "var(--ink)", color: "var(--paper)", borderRadius: 10, fontSize: 13 }}>
            <span>{tr(isAr, `Deleted "${undoDelete.entry.word}".`, `اتمسحت "${undoDelete.entry.word}".`)}</span>
            <button onClick={handleUndoDelete} className="lift-hover"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 13, fontWeight: 700, color: "var(--ink)", background: "var(--paper)", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
              <UndoIcon size={14} /> {tr(isAr, "Undo", "تراجع")}
            </button>
          </div>
        )}
        {!focusMode && (
          <div className="mobile-banners-stack">
            <ReminderBanner studiedAt={studiedAt} isAr={appIsAr} cfg={cfg} remindersOn={remindersOn} reminderTitle={reminderTitle} reminderMessage={reminderMessage} onOpenQuiz={() => { setQuizDueOnly(true); setShowQuiz(true); }} />
            {isAdmin && <BackupReminderBanner isAr={appIsAr} cfg={cfg} onOpenBackup={onOpenAdmin} />}
          </div>
        )}
        <div style={{ marginTop: 12, background: CARD, border: "1px solid rgba(var(--border-rgb),0.12)", borderRadius: 10, padding: "12px 14px" }}>
          <div dir={isAr ? "rtl" : "ltr"} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: INK }}>
              <BookIcon size={14} color={cfg.accent} />
              {tr(isAr, `${sectionEntries.length} words`, `${sectionEntries.length} الكلمات`)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: cfg.accent, borderRadius: 20, padding: "5px 12px", whiteSpace: "nowrap" }}>
                {tr(isAr, `${notStudiedCount} to learn`, `${notStudiedCount} تعلم`)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--success)", borderRadius: 20, padding: "5px 12px", whiteSpace: "nowrap" }}>
                {tr(isAr, `${studiedCount} know`, `${studiedCount} أعرف`)}
              </span>
            </div>
          </div>
          {sectionEntries.length > 0 && (
            <div dir={isAr ? "rtl" : "ltr"} style={{ marginTop: 10, height: 8, borderRadius: 20, overflow: "hidden", display: "flex", background: "rgba(var(--border-rgb),0.15)" }}>
              <div style={{ width: `${notStudiedPct}%`, background: cfg.accent, transition: "width 0.3s" }} />
              <div style={{ width: `${studiedPct}%`, background: "var(--success)", transition: "width 0.3s" }} />
            </div>
          )}
          {(query.trim() || studyFilter !== "all") && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              {tr(isAr, `${filtered.length} of ${sectionEntries.length} word${sectionEntries.length === 1 ? "" : "s"} shown`, `عرض ${filtered.length} من ${sectionEntries.length} كلمة`)}
            </div>
          )}
        </div>
        <EntryFiltersBar
          cfg={cfg}
          isAr={isAr}
          studyFilter={studyFilter}
          setStudyFilter={setStudyFilter}
          posFilter={posFilter}
          setPosFilter={setPosFilter}
          dateFilter={dateFilter}
          setDateFilter={setDateFilter}
          sortKey={sortKey}
          setSortKey={setSortKey}
          mobileFiltersOpen={mobileFiltersOpen}
          setMobileFiltersOpen={setMobileFiltersOpen}
        />
        {loadError && <div style={{ ...errorStyle, marginTop: 10 }} role="alert" aria-live="assertive">{tr(isAr, loadError, "تعذر تحميل القاموس المشترك. تحقق من اتصالك وحاول تحديث الصفحة.")}</div>}
        {saveError && <div style={{ ...errorStyle, marginTop: 10 }} role="alert" aria-live="assertive">{tr(isAr, saveError, "تعذر الحفظ — تحقق من اتصالك وحاول مرة أخرى.")}</div>}
        {isOffline && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", fontSize: 13, color: "var(--muted-strong)", background: "var(--input-bg)", border: "1px dashed rgba(var(--border-rgb),0.3)", borderRadius: 6 }} role="status">
            <WifiOffIcon size={14} color="var(--icon-muted)" />
            {tr(isAr,
              `You're offline — showing your saved words${offlineCachedAt ? ` from ${new Date(offlineCachedAt).toLocaleString()}` : ""}. Adding or editing words needs a connection.`,
              `أنت غير متصل — يتم عرض كلماتك المحفوظة${offlineCachedAt ? ` من ${new Date(offlineCachedAt).toLocaleString()}` : ""}. إضافة أو تعديل الكلمات يحتاج اتصال بالإنترنت.`)}
          </div>
        )}
      </div>

      <WordListPanel
        cfg={cfg}
        section={section}
        isAr={isAr}
        appIsAr={appIsAr}
        entriesLoaded={entriesLoaded}
        filtered={filtered}
        query={query}
        studyFilter={studyFilter}
        onOpenAdd={onOpenAdd}
        flatSorted={flatSorted}
        visibleCount={visibleCount}
        grouped={grouped}
        hasMore={hasMore}
        loadMoreRef={loadMoreRef}
        loadMore={loadMore}
        availableLetters={availableLetters}
        jumpTo={jumpTo}
        isAdmin={isAdmin}
        accountCode={accountCode}
        deviceMode={deviceMode}
        studiedIds={studiedIds}
        favoriteIds={favoriteIds}
        accountNameByCode={accountNameByCode}
        onDelete={handleDelete}
        onEdit={handleEditRequest}
        onOpenZoom={handleZoomRequest}
        onToggleStudied={handleToggleStudiedById}
        onToggleFavorite={handleToggleFavoriteById}
        wordPriorities={wordPriorities}
        onCyclePriority={handleCyclePriority}
        srsDueAt={srsDueAt}
      />

      {showWelcome && (
        <WelcomeOnboardingModal
          isAr={appIsAr}
          userName={name}
          onClose={() => {
            markWelcomeSeen(accountCode);
            setShowWelcome(false);
          }}
        />
      )}

      <MainViewOverlays
        cfg={cfg}
        section={section}
        sectionEntries={sectionEntries}
        entries={entries}
        accounts={accounts}
        accountCode={accountCode}
        name={name}
        isAdmin={isAdmin}
        appIsAr={appIsAr}
        appLang={appLang}
        studiedIds={studiedIds}
        studiedAt={studiedAt}
        favoriteIds={favoriteIds}
        srsBox={srsBox}
        srsDueAt={srsDueAt}
        quizHistory={quizHistory}
        sessionStart={sessionStart}
        logs={logs}
        examConfig={examConfig}
        showAdd={showAdd}
        onCloseAdd={onCloseAdd}
        handleAdd={handleAdd}
        handleEdit={handleEdit}
        editingEntry={editingEntry}
        setEditingEntry={setEditingEntry}
        zoomEntry={zoomEntry}
        setZoomEntry={setZoomEntry}
        zoomAlreadyExists={zoomAlreadyExists}
        setZoomAlreadyExists={setZoomAlreadyExists}
        setDupNotice={setDupNotice}
        wordNotes={wordNotes}
        setWordNotes={setWordNotes}
        showQuiz={showQuiz}
        setShowQuiz={setShowQuiz}
        quizDueOnly={quizDueOnly}
        setQuizDueOnly={setQuizDueOnly}
        onRecordSrsAnswer={onRecordSrsAnswer}
        onSaveQuizResult={onSaveQuizResult}
        showExamSettings={showExamSettings}
        setShowExamSettings={setShowExamSettings}
        onPersistExamConfig={onPersistExamConfig}
        showExamMode={showExamMode}
        setShowExamMode={setShowExamMode}
        showFlashcards={showFlashcards}
        setShowFlashcards={setShowFlashcards}
        onToggleStudied={onToggleStudied}
        showStats={showStats}
        setShowStats={setShowStats}
        showLeaderboard={showLeaderboard}
        setShowLeaderboard={setShowLeaderboard}
        showDashboard={showDashboard}
        setShowDashboard={setShowDashboard}
        setStudyFilter={setStudyFilter}
        openGoals={openGoals}
        openCalendar={openCalendar}
        showWordLists={showWordLists}
        setShowWordLists={setShowWordLists}
        showToast={showToast}
        persistEntries={persistEntries}
        showChallenges={showChallenges}
        setShowChallenges={setShowChallenges}
        showSmartCards={showSmartCards}
        setShowSmartCards={setShowSmartCards}
        showConversation={showConversation}
        setShowConversation={setShowConversation}
        showLevels={showLevels}
        setShowLevels={setShowLevels}
        showLevelUpNow={showLevelUpNow}
        pendingLevelUp={pendingLevelUp}
        setPendingLevelUp={setPendingLevelUp}
        showProgressCompare={showProgressCompare}
        setShowProgressCompare={setShowProgressCompare}
        showTextExtract={showTextExtract}
        setShowTextExtract={setShowTextExtract}
        showAiPdfExtract={showAiPdfExtract}
        academicUnits={academicUnits}
        activeUnitId={activeUnitId}
        setShowAiPdfExtract={setShowAiPdfExtract}
        showAccount={showAccount}
        onCloseAccount={onCloseAccount}
        onUpdateOwnAccount={onUpdateOwnAccount}
        showAdmin={showAdmin}
        onCloseAdmin={onCloseAdmin}
        onClearLogs={onClearLogs}
        onAdminAddAccount={onAdminAddAccount}
        onAdminEditAccount={onAdminEditAccount}
        onAdminDeleteAccount={onAdminDeleteAccount}
        showDictation={showDictation}
        setShowDictation={setShowDictation}
        onDictationRoundFinished={onDictationRoundFinished}
        showAchievements={showAchievements}
        setShowAchievements={setShowAchievements}
        showRandomWord={showRandomWord}
        setShowRandomWord={setShowRandomWord}
        showQuickReview={showQuickReview}
        setShowQuickReview={setShowQuickReview}
        showWeaknessReview={showWeaknessReview}
        setShowWeaknessReview={setShowWeaknessReview}
        showListeningLoop={showListeningLoop}
        setShowListeningLoop={setShowListeningLoop}
        showSentencePractice={showSentencePractice}
        setShowSentencePractice={setShowSentencePractice}
        showWeeklyReport={showWeeklyReport}
        setShowWeeklyReport={setShowWeeklyReport}
        srsStats={srsStats}
        wordPriorities={wordPriorities}
        showInfoGuide={showInfoGuide}
        setShowInfoGuide={setShowInfoGuide}
      />

      {dupNotice && dupNotice.entry && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "min(440px, calc(100vw - 24px))",
            background: "var(--card, #1a1f2e)",
            color: "var(--ink, #fff)",
            padding: "12px 14px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 12px 32px -8px rgba(0,0,0,0.45)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            border: "1px solid color-mix(in srgb, var(--warning, #e6a817) 50%, transparent)",
          }}
        >
          <span style={{ flex: "1 1 160px", lineHeight: 1.4 }}>
            {tr(
              appIsAr,
              `"${dupNotice.entry.word}" is already in the dictionary.`,
              `«${dupNotice.entry.word}» موجودة أصلًا في القاموس.`
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              const e = dupNotice.entry;
              setDupNotice(null);
              setZoomAlreadyExists(true);
              setZoomEntry(e);
            }}
            style={{
              border: "none",
              cursor: "pointer",
              background: "var(--accent-1, #19A7CE)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 12,
              padding: "8px 12px",
              borderRadius: 8,
              whiteSpace: "nowrap",
            }}
          >
            {tr(appIsAr, "Go to it", "اذهب إليها")}
          </button>
          <button
            type="button"
            onClick={() => setDupNotice(null)}
            aria-label={tr(appIsAr, "Dismiss", "إغلاق")}
            style={{
              border: "none",
              cursor: "pointer",
              background: "transparent",
              color: "var(--muted-strong, #aaa)",
              width: 32,
              height: 32,
              padding: 0,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
      {toast && !dupNotice && (
        <div role="status" aria-live="polite" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "var(--success)", color: "#fff", padding: "10px 18px", borderRadius: 4, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 24px -10px rgba(0,0,0,0.35)", zIndex: 10000, display: "flex", alignItems: "center", gap: 7 }}>
          <CheckIcon size={14} /> {tr(isAr, toast, toast === "Account info updated." ? "تم تحديث بيانات الحساب." : toast)}
        </div>
      )}
      {/* Minecraft-style achievement toasts — portal + z-index 12000 (above all modals/toasts) */}
      <MinecraftAchievementToast isAr={appIsAr} />
    </div>

    <ToolShell
      isAr={isAr}
      appIsAr={appIsAr}
      accountCode={accountCode}
      cfg={cfg}
      entries={entries}
      studiedAt={studiedAt}
      quizHistory={quizHistory}
      focusMode={focusMode}
      deviceMode={deviceMode}
      showTimer={showTimer}
      timerBubble={timerBubble}
      closeTimer={closeTimer}
      setTimerBubble={setTimerBubble}
      showCalendar={showCalendar}
      calendarBubble={calendarBubble}
      closeCalendar={closeCalendar}
      setCalendarBubble={setCalendarBubble}
      showTodo={showTodo}
      todoBubble={todoBubble}
      closeTodo={closeTodo}
      setTodoBubble={setTodoBubble}
      openTodo={openTodo}
      showGoals={showGoals}
      goalsBubble={goalsBubble}
      closeGoals={closeGoals}
      setGoalsBubble={setGoalsBubble}
      openGoals={openGoals}
    />

    {deviceMode === "mobile" && !focusMode && (
      <button
        type="button"
        className="mobile-fab-add"
        onClick={() => onOpenAdd && onOpenAdd()}
        aria-label={tr(appIsAr, "Add word", "إضافة كلمة")}
        title={tr(appIsAr, "Add word", "إضافة كلمة")}
      >
        <PlusIcon size={26} />
      </button>
    )}


    {/* Tablet side dock removed — tablet uses header/menu like desktop; phone keeps bottom nav + FAB */}

    {deviceMode === "mobile" && !focusMode && (
      <MobileBottomNav
        isAr={appIsAr}
        mobileNavTab={mobileNavTab}
        setMobileNavTab={setMobileNavTab}
        showQuiz={showQuiz}
        showGoals={showGoals}
        showTodo={showTodo}
        dueCountMobile={dueCountMobile}
        onOpenQuiz={() => { setQuizDueOnly(false); setShowQuiz(true); }}
        onOpenDueQuiz={() => { setQuizDueOnly(true); setShowQuiz(true); }}
        onOpenGoals={() => { setGoalsBubble(false); setShowGoals(true); }}
        onOpenTodo={() => { setTodoBubble(false); setShowTodo(true); }}
        onOpenAccount={() => onOpenAccount && onOpenAccount()}
      />
    )}

    {/* Focus mode exit chip */}
    {focusMode && (
      <button
        type="button"
        onClick={() => setFocusMode(false)}
        style={{
          position: "fixed",
          top: "calc(12px + env(safe-area-inset-top, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 60,
          padding: "8px 14px",
          borderRadius: 20,
          border: "none",
          background: "var(--ink)",
          color: "var(--paper)",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 8px 20px -8px rgba(0,0,0,0.4)",
        }}
      >
        {tr(isAr, "Exit focus mode (F)", "خروج من وضع التركيز (F)")}
      </button>
    )}
    </>
  );
}

