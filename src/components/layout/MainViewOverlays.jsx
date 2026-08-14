import { Suspense } from "react";
import { tr } from "../../lib/config/i18n";
import { computeStreak } from "../../lib/utils/quizHelpers";
import { importWordsFromList, importWordsFromText, importWordsFromAi } from "../../lib/state/entryMutations";
import { grantSmartCard, grantConversation, grantExtract } from "../../lib/state/xp";
import { setWordNote } from "../../lib/state/wordNotes";
import { loadProgress } from "../../lib/state/goals";
import {
  QuizModal,
  ExamModeModal,
  ExamSettingsModal,
  StatsModal,
  LeaderboardModal,
  FlashcardsModal,
  AddModal,
  AccountModal,
  AdminModal,
  WordZoomModal,
  QuickReviewModal,
  DictationModal,
  AchievementsModal,
  RandomWordModal,
  DashboardPage,
  WordListsModal,
  ChallengeModal,
  SmartCardsModal,
  ConversationModal,
  LevelsModal,
  LevelUpModal,
  ProgressCompareModal,
  TextExtractModal,
  AiPdfExtractModal,
  InfoGuideModal,
  WeaknessReviewModal,
  ListeningLoopModal,
  SentencePracticeModal,
  WeeklyReportModal,
} from "../modals/lazyModals";

/** Lightweight shell while a lazy modal chunk downloads. */
function ModalChunkFallback({ label = "Loading…" }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--card)",
          color: "var(--ink)",
          borderRadius: 16,
          padding: "28px 32px",
          minWidth: 160,
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          border: "1px solid rgba(var(--border-rgb),0.14)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "3px solid rgba(var(--border-rgb),0.25)",
            borderTopColor: "var(--accent-1)",
            animation: "tt-spin 0.6s linear infinite",
          }}
        />
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-strong)" }}>{label}</div>
        <style>{`@keyframes tt-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

/** Feature overlays (add/edit/zoom/quiz/practice/admin) for MainView. */
export default function MainViewOverlays(p) {
  const {
    cfg, section, sectionEntries, entries, accounts, accountCode, name, isAdmin,
    appIsAr, appLang, studiedIds, studiedAt, favoriteIds, srsBox, srsDueAt,
    quizHistory, sessionStart, logs, examConfig,
    showAdd, onCloseAdd, handleAdd, handleEdit, editingEntry, setEditingEntry,
    zoomEntry, setZoomEntry, zoomAlreadyExists, setZoomAlreadyExists, wordNotes, setWordNotes,
    showQuiz, setShowQuiz, quizDueOnly, setQuizDueOnly, onRecordSrsAnswer, onSaveQuizResult,
    showExamSettings, setShowExamSettings, onPersistExamConfig,
    showExamMode, setShowExamMode,
    showFlashcards, setShowFlashcards, onToggleStudied,
    showStats, setShowStats,
    showLeaderboard, setShowLeaderboard,
    showDashboard, setShowDashboard, setStudyFilter, openGoals, openCalendar,
    showWordLists, setShowWordLists, showToast, persistEntries,
    showChallenges, setShowChallenges,
    showSmartCards, setShowSmartCards,
    showConversation, setShowConversation,
    showLevels, setShowLevels,
    showLevelUpNow, pendingLevelUp, setPendingLevelUp,
    showProgressCompare, setShowProgressCompare,
    showTextExtract, setShowTextExtract,
    showAiPdfExtract, setShowAiPdfExtract,
    showAccount, onCloseAccount, onUpdateOwnAccount,
    showAdmin, onCloseAdmin, onClearLogs, onAdminAddAccount, onAdminEditAccount, onAdminDeleteAccount,
    showDictation, setShowDictation, onDictationRoundFinished,
    showAchievements, setShowAchievements,
    showRandomWord, setShowRandomWord,
    showQuickReview, setShowQuickReview,
    showWeaknessReview, setShowWeaknessReview,
    showListeningLoop, setShowListeningLoop,
    showSentencePractice, setShowSentencePractice,
    showWeeklyReport, setShowWeeklyReport,
    showInfoGuide, setShowInfoGuide,
    srsStats,
  } = p;

  // Local aliases used by copied JSX from MainView
  const setDupNotice = p.setDupNotice;

  // Academic: practice/exam tools can span multiple units (not only the active one)
  const isAcademic = section === "academic";
  const practiceEntries = isAcademic
    ? (entries || []).filter((e) => e.section === "academic")
    : sectionEntries;
  const practiceUnits = isAcademic ? (p.academicUnits || []) : null;
  const practiceActiveUnitId = isAcademic ? (p.activeUnitId || null) : null;

  return (
    <>
      <Suspense fallback={null}>
        {showAdd && (
          <AddModal
            cfg={cfg}
            onClose={onCloseAdd}
            onSubmit={handleAdd}
            findExisting={(w) => {
              const key = (w || "").trim().toLowerCase();
              if (!key) return null;
              return sectionEntries.find((e) => (e.word || "").trim().toLowerCase() === key) || null;
            }}
            onGoToExisting={(entry) => {
              onCloseAdd();
              setDupNotice(null);
              setZoomAlreadyExists(true);
              setZoomEntry(entry);
            }}
          />
        )}
        {editingEntry && (
          <AddModal
            cfg={cfg}
            initialEntry={editingEntry}
            onClose={() => setEditingEntry(null)}
            onSubmit={(updates) => handleEdit(editingEntry.id, updates)}
          />
        )}
        {zoomEntry && (
          <WordZoomModal
            entry={zoomEntry}
            cfg={cfg}
            onClose={() => { setZoomEntry(null); setZoomAlreadyExists(false); }}
            wordNote={wordNotes[zoomEntry.id] || ""}
            onSaveNote={(note) => setWordNotes(setWordNote(accountCode, zoomEntry.id, note))}
            alreadyExists={zoomAlreadyExists}
          />
        )}
        {showQuiz && (
          <QuizModal
            entries={practiceEntries}
            sectionLabel={cfg.shortLabel}
            studiedIds={studiedIds}
            studiedAt={studiedAt}
            srsDueAt={srsDueAt}
            sessionStart={sessionStart}
            isAr={appIsAr}
            initialDueOnly={quizDueOnly}
            academicUnits={practiceUnits}
            activeUnitId={practiceActiveUnitId}
            onClose={() => { setShowQuiz(false); setQuizDueOnly(false); }}
            onRecordSrsAnswer={onRecordSrsAnswer}
            onSaveQuizResult={onSaveQuizResult}
          />
        )}
        
        {showExamSettings && isAdmin && (
          <Suspense fallback={null}>
            <ExamSettingsModal
              examConfig={examConfig}
              onPersist={onPersistExamConfig}
              isAr={appIsAr}
              onClose={() => setShowExamSettings(false)}
            />
          </Suspense>
        )}

        {showExamMode && (
          <Suspense fallback={null}>
            <ExamModeModal
              entries={practiceEntries}
              studiedIds={studiedIds}
              studiedAt={studiedAt}
              srsDueAt={srsDueAt}
              srsBox={srsBox}
              isAr={appIsAr}
              sectionLabel={cfg.shortLabel}
              academicUnits={practiceUnits}
              activeUnitId={practiceActiveUnitId}
              onClose={() => setShowExamMode(false)}
              onRecordSrsAnswer={onRecordSrsAnswer}
              onSaveQuizResult={onSaveQuizResult}
            />
          </Suspense>
        )}
        {showFlashcards && (
          <FlashcardsModal
            entries={practiceEntries}
            cfg={cfg}
            sectionLabel={cfg.shortLabel}
            studiedIds={studiedIds}
            favoriteIds={favoriteIds}
            onToggleStudied={onToggleStudied}
            isAr={appIsAr}
            academicUnits={practiceUnits}
            activeUnitId={practiceActiveUnitId}
            onClose={() => setShowFlashcards(false)}
          />
        )}
        {showStats && (
          <StatsModal
            entries={sectionEntries}
            sectionLabel={cfg.shortLabel}
            studiedIds={studiedIds}
            studiedAt={studiedAt}
            srsBox={srsBox}
            srsDueAt={srsDueAt}
            quizHistory={quizHistory}
            isAr={appIsAr}
            cfg={cfg}
            onClose={() => setShowStats(false)}
          />
        )}
        {showLeaderboard && (
          <LeaderboardModal
            accounts={accounts}
            sectionEntries={sectionEntries}
            accountCode={accountCode}
            sectionLabel={cfg.shortLabel}
            isAr={appIsAr}
            cfg={cfg}
            onClose={() => setShowLeaderboard(false)}
          />
        )}
        {showDashboard && (
          <DashboardPage
            onClose={() => setShowDashboard(false)}
            isAr={appIsAr}
            entries={entries}
            studiedIds={studiedIds}
            studiedAt={studiedAt}
            favoriteIds={favoriteIds}
            srsBox={srsBox}
            srsDueAt={srsDueAt}
            quizHistory={quizHistory}
            streak={computeStreak(studiedAt)}
            section={section}
            name={name}
            onOpenQuiz={() => { setShowQuiz(true); }}
            onOpenDue={() => { setStudyFilter("due"); setQuizDueOnly(true); setShowQuiz(true); }}
            onOpenStats={() => { setShowStats(true); }}
            onOpenGoals={openGoals}
            onOpenCalendar={openCalendar}
            onOpenFlashcards={() => { setShowFlashcards(true); }}
            onOpenSmartCards={() => { setShowSmartCards(true); setShowDashboard(false); }}
          />
        )}
        {showWordLists && (
          <WordListsModal
            accountCode={accountCode}
            entries={entries}
            section={section}
            isAr={appIsAr}
            onClose={() => setShowWordLists(false)}
            showToast={showToast}
            onImportWords={(words, listSection) =>
              importWordsFromList({
                words,
                listSection,
                section,
                entries,
                accountCode,
                name,
                isAr,
                persistEntries,
                showToast,
              })
            }
          />
        )}
        {showChallenges && (
          <ChallengeModal
            accountCode={accountCode}
            accountName={name}
            accounts={accounts}
            isAr={appIsAr}
            onClose={() => setShowChallenges(false)}
            showToast={showToast}
          />
        )}

        {showSmartCards && (
          <Suspense fallback={null}>
            <SmartCardsModal
              entries={practiceEntries}
              studiedIds={studiedIds}
              favoriteIds={favoriteIds}
              isAr={appIsAr}
              academicUnits={practiceUnits}
              activeUnitId={practiceActiveUnitId}
              onClose={() => setShowSmartCards(false)}
              onRecordSrsAnswer={onRecordSrsAnswer}
              onXp={(entryId) => {
                try {
                  const r = grantSmartCard(accountCode, entryId);
                  if (r && r.leveledUp) showToast?.(appIsAr ? `مستوى جديد: ${r.levelInfo.level}` : `Level up: ${r.levelInfo.level}`);
                } catch (_) {}
              }}
            />
          </Suspense>
        )}
        {showConversation && (
          <Suspense fallback={null}>
            <ConversationModal
              entries={practiceEntries}
              studiedIds={studiedIds}
              isAr={appIsAr}
              academicUnits={practiceUnits}
              activeUnitId={practiceActiveUnitId}
              onClose={() => setShowConversation(false)}
              onXp={(scenarioId) => {
                try {
                  const r = grantConversation(accountCode, scenarioId);
                  if (r && r.leveledUp) showToast?.(appIsAr ? `مستوى جديد: ${r.levelInfo.level}` : `Level up: ${r.levelInfo.level}`);
                } catch (_) {}
              }}
            />
          </Suspense>
        )}
        {showLevels && (
          <Suspense fallback={null}>
            <LevelsModal accountCode={accountCode} isAr={appIsAr} onClose={() => setShowLevels(false)} />
          </Suspense>
        )}
        {showLevelUpNow && pendingLevelUp && (
          <Suspense fallback={null}>
            <LevelUpModal
              isAr={appIsAr}
              fromLevel={pendingLevelUp.fromLevel}
              toLevel={pendingLevelUp.toLevel}
              titleEn={pendingLevelUp.titleEn}
              titleAr={pendingLevelUp.titleAr}
              rewardKey={pendingLevelUp.rewardKey}
              rewardEn={pendingLevelUp.rewardEn}
              rewardAr={pendingLevelUp.rewardAr}
              onClose={() => setPendingLevelUp(null)}
            />
          </Suspense>
        )}
        {showProgressCompare && (
          <Suspense fallback={null}>
            <ProgressCompareModal
              accountCode={accountCode}
              isAr={appIsAr}
              onClose={() => setShowProgressCompare(false)}
              currentStats={{
                studied: studiedIds ? studiedIds.size : 0,
                quizzes: (quizHistory && quizHistory.length) || 0,
                streak: computeStreak(studiedAt),
                mastered: srsBox ? Object.values(srsBox).filter((b) => b >= 5).length : 0,
              }}
            />
          </Suspense>
        )}
        {showTextExtract && (
          <Suspense fallback={null}>
            <TextExtractModal
              section={section}
              entries={entries}
              isAr={appIsAr}
              onClose={() => setShowTextExtract(false)}
              showToast={showToast}
              onAddWords={(words) =>
                importWordsFromText({
                  words,
                  section,
                  entries,
                  accountCode,
                  name,
                  appIsAr,
                  persistEntries,
                  showToast,
                  onGrantedExtract: (n) => {
                    try { grantExtract(accountCode, n); } catch (_) {}
                  },
                })
              }
            />
          </Suspense>
        )}
        {showAiPdfExtract && (
          <Suspense fallback={null}>
            <AiPdfExtractModal
              section={section}
              entries={entries}
              isAr={appIsAr}
              academicUnits={p.academicUnits || []}
              activeUnitId={p.activeUnitId || null}
              onClose={() => setShowAiPdfExtract(false)}
              showToast={showToast}
              onAddEntries={(aiEntries, unitId) =>
                importWordsFromAi({
                  aiEntries,
                  section,
                  entries,
                  accountCode,
                  name,
                  appIsAr,
                  persistEntries,
                  showToast,
                  unitId: unitId || p.activeUnitId || null,
                })
              }
            />
          </Suspense>
        )}
        {showAccount && (
          <AccountModal
            account={accounts.find((a) => a.code === accountCode) || { name, code: accountCode, role: isAdmin ? "admin" : "user" }}
            onClose={onCloseAccount}
            onSave={onUpdateOwnAccount}
            isAr={appIsAr}
            lang={appLang}
          />
        )}
        {showAdmin && (
          <Suspense fallback={<ModalChunkFallback label={tr(appIsAr, "Opening admin…", "جاري فتح لوحة التحكم…")} />}>
            <AdminModal
              accounts={accounts}
              entries={entries}
              myAccountCode={accountCode}
              logs={logs}
              onClearLogs={onClearLogs}
              onClose={onCloseAdmin}
              onAdd={onAdminAddAccount}
              onEdit={onAdminEditAccount}
              onDelete={onAdminDeleteAccount}
              isAr={appIsAr}
              onOpenAiPdf={() => setShowAiPdfExtract(true)}
            />
          </Suspense>
        )}
      </Suspense>
    {showInfoGuide && (
      <Suspense fallback={null}>
        <InfoGuideModal isAr={appIsAr} onClose={() => setShowInfoGuide(false)} />
      </Suspense>
    )}

    {showQuickReview && (
      <Suspense fallback={null}>
        <QuickReviewModal
          entries={practiceEntries}
          studiedIds={studiedIds}
          srsDueAt={srsDueAt}
          isAr={appIsAr}
          academicUnits={practiceUnits}
          activeUnitId={practiceActiveUnitId}
          onClose={() => setShowQuickReview(false)}
          onToggleStudied={onToggleStudied}
          onRecordSrsAnswer={onRecordSrsAnswer}
        />
      </Suspense>
    )}

    {showWeaknessReview && (
      <Suspense fallback={null}>
        <WeaknessReviewModal
          entries={practiceEntries}
          studiedIds={studiedIds}
          srsStats={srsStats}
          srsDueAt={srsDueAt}
          wordPriorities={p.wordPriorities || {}}
          isAr={appIsAr}
          academicUnits={practiceUnits}
          activeUnitId={practiceActiveUnitId}
          onClose={() => setShowWeaknessReview(false)}
          onRecordSrsAnswer={onRecordSrsAnswer}
        />
      </Suspense>
    )}

    {showListeningLoop && (
      <Suspense fallback={null}>
        <ListeningLoopModal
          entries={practiceEntries}
          studiedIds={studiedIds}
          srsStats={srsStats}
          srsDueAt={srsDueAt}
          isAr={appIsAr}
          academicUnits={practiceUnits}
          activeUnitId={practiceActiveUnitId}
          onClose={() => setShowListeningLoop(false)}
          onRecordSrsAnswer={onRecordSrsAnswer}
        />
      </Suspense>
    )}

    {showSentencePractice && (
      <Suspense fallback={null}>
        <SentencePracticeModal
          entries={practiceEntries}
          studiedIds={studiedIds}
          srsStats={srsStats}
          srsDueAt={srsDueAt}
          isAr={appIsAr}
          academicUnits={practiceUnits}
          activeUnitId={practiceActiveUnitId}
          onClose={() => setShowSentencePractice(false)}
          onRecordSrsAnswer={onRecordSrsAnswer}
        />
      </Suspense>
    )}


    {showWeeklyReport && (
      <Suspense fallback={null}>
        <WeeklyReportModal
          entries={sectionEntries}
          studiedIds={studiedIds}
          studiedAt={studiedAt}
          srsStats={srsStats}
          srsDueAt={srsDueAt}
          wordPriorities={p.wordPriorities || {}}
          isAr={appIsAr}
          onClose={() => setShowWeeklyReport(false)}
        />
      </Suspense>
    )}

    {showDictation && (
      <Suspense
        fallback={
          <div
            role="status"
            aria-live="polite"
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
          >
            <div
              style={{
                width: "100%",
                maxWidth: 480,
                background: "var(--card)",
                borderRadius: "16px 16px 12px 12px",
                padding: "28px 20px",
                textAlign: "center",
                color: "var(--muted-strong)",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {tr(appIsAr, "Loading dictation…", "جاري فتح الإملاء…")}
            </div>
          </div>
        }
      >
        <DictationModal
          entries={practiceEntries}
          studiedIds={studiedIds}
          isAr={appIsAr}
          academicUnits={practiceUnits}
          activeUnitId={practiceActiveUnitId}
          onClose={() => setShowDictation(false)}
          onRecordSrsAnswer={onRecordSrsAnswer}
          onFinishRound={() => {
            try {
              if (typeof onDictationRoundFinished === "function") onDictationRoundFinished();
              else {
                const k = "twoTongues.dictationRounds." + accountCode;
                const n = Number(localStorage.getItem(k) || 0) + 1;
                localStorage.setItem(k, String(n));
              }
            } catch (_) {}
          }}
        />
      </Suspense>
    )}

    {showAchievements && (
      <Suspense fallback={null}>
        <AchievementsModal
          unlockedIds={(accounts.find((a) => a.code === accountCode) || {}).achievements || []}
          isAr={appIsAr}
          onClose={() => setShowAchievements(false)}
          account={accounts.find((a) => a.code === accountCode) || null}
          streak={computeStreak(studiedAt)}
          srsBox={srsBox}
          timerMinutesTotal={(() => {
            try {
              const p = loadProgress();
              return Object.values(p.timerMinutesByDay || {}).reduce((s, n) => s + (Number(n) || 0), 0);
            } catch (_) { return 0; }
          })()}
          dictationRounds={(() => {
            try { return Number(localStorage.getItem("twoTongues.dictationRounds." + accountCode) || 0); } catch (_) { return 0; }
          })()}
        />
      </Suspense>
    )}

    {showRandomWord && (
      <Suspense fallback={null}>
        <RandomWordModal
          entries={practiceEntries}
          studiedIds={studiedIds}
          srsDueAt={srsDueAt}
          isAr={appIsAr}
          section={section}
          academicUnits={practiceUnits}
          activeUnitId={practiceActiveUnitId}
          onClose={() => setShowRandomWord(false)}
          onRecordSrsAnswer={onRecordSrsAnswer}
          onToggleStudied={onToggleStudied}
        />
      </Suspense>
    )}


    </>
  );
}
