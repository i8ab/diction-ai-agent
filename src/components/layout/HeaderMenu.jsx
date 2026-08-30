import { useState, useEffect, useRef } from "react";
import { tr } from "../../lib/config/i18n";
import SiteBannerAdminModal from "./SiteBannerAdminModal";
import NotificationsModal from "./NotificationsModal";
import SettingsModal from "./SettingsModal";
import AppearanceModal from "./AppearanceModal";
import { preloadSettingsHeavy } from "../modals/lazyModals";
import { DeviceModeModal, LangModal, AccentModal } from "./PreferenceModals";

import { SettingsIcon } from "../common/Icons";
import { useBodyScrollLock } from "../../lib/utils/useBodyScrollLock";
import {
  loadPresetId,
  loadCustomGlyph,
} from "../common/BrandMark";

export default function HeaderMenu({
  theme, onToggleTheme, onChangeTheme, isAdmin, onOpenAccount, onOpenAdmin, onLogout, isAr,
  appLang = "en", onChangeAppLang,
  deviceMode = null, onChangeDeviceMode = null, uiScale = 1, onChangeUiScale = null,
  accentTheme, onChangeAccent,
  skin = "classic", onChangeSkin = null,
  latinFont = "source-sans", onChangeLatinFont = null,
  arabicFont = "amiri", onChangeArabicFont = null,
  reducedMotion = false, onChangeReducedMotion = null,
  uiSounds = false, onChangeUiSounds = null,
  dirOverride = "auto", onChangeDirOverride = null,
  cardSurface = "solid", onChangeCardSurface = null,
  headerStyle = "glass", onChangeHeaderStyle = null,
  cardClarity = "opaque", onChangeCardClarity = null,
  modalStyle = "glass", onChangeModalStyle = null,
  iconStyle = "outline", onChangeIconStyle = null,
  motionSpeed = "normal", onChangeMotionSpeed = null,
  examVisual = false, onChangeExamVisual = null,
  remindersOn, remindersBusy, onEnableReminders, onDisableReminders, onTestReminder, onClearReminderSlots,
  reminderTitle, onChangeReminderTitle,
  reminderMessage, onChangeReminderMessage,
  reminderMessages = [], onChangeReminderMessages = null,
  reminderIntervalHours, onChangeReminderIntervalHours,
  pendingAccounts = [],
  onApproveRequest,
  onRejectRequest,
  // Admin: site-wide banner + broadcast push (live in this menu)
  siteBanner = null,
  onPersistSiteBanner = null,
  onOpenExamSettings = null,
  myAccountCode = null,
  onOpenAchievements = null,
  vaultAccounts = [],
  mainAccountCode = "",
  accountCode = "",
  onSwitchAccount = null,
  onSetMainAccount = null,
  onUnlinkVaultAccount = null,
  onLogoutAll = null,
  onLinkAccount = null,
}) {
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brandPresetId, setBrandPresetId] = useState(() => loadPresetId());
  const [brandCustomGlyph, setBrandCustomGlyph] = useState(() => loadCustomGlyph());
  const [brandAddMode, setBrandAddMode] = useState(false);
  const [brandDraftCustom, setBrandDraftCustom] = useState("");
  const [langModalOpen, setLangModalOpen] = useState(false);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [accentModalOpen, setAccentModalOpen] = useState(false);
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);
  // Density fixed to Comfortable — Compact option removed.
  const [uiDensity, setUiDensity] = useState("comfortable");
  const [uiRadius, setUiRadius] = useState(() => {
    try {
      const v = localStorage.getItem("tt_ui_radius");
      return v === "sharp" || v === "round" || v === "soft" ? v : "soft";
    } catch (_) { return "soft"; }
  });
  const [cardHeight, setCardHeight] = useState(() => {
    try {
      const v = localStorage.getItem("tt_card_height");
      return v === "compact" || v === "comfortable" || v === "normal" ? v : "normal";
    } catch (_) { return "normal"; }
  });
  const ref = useRef(null);


  useEffect(() => {
    try {
      document.documentElement.dataset.density = "comfortable";
      localStorage.setItem("tt_ui_density", "comfortable");
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      document.documentElement.dataset.radius = uiRadius;
      localStorage.setItem("tt_ui_radius", uiRadius);
    } catch (_) {}
  }, [uiRadius]);

  useEffect(() => {
    try {
      document.documentElement.dataset.cardHeight = cardHeight;
      localStorage.setItem("tt_card_height", cardHeight);
    } catch (_) {}
  }, [cardHeight]);
  const pendingCount = (pendingAccounts || []).length;
  // UI language for chrome strings (settings / menu). RTL still uses isAr.
  const lang = appLang || (isAr ? "ar" : "en");
  const T = (en, ar, de, fr) => tr(lang, en, ar, de, fr);

  function closeMenu() {
    setOpen(false);
  }

  function openSettings() {
    // Keep the menu open underneath — settings stacks above it
    setSettingsOpen(true);
    // Warm up heavy modals the user is likely to open next
    try { preloadSettingsHeavy(); } catch (_) {}
  }

  function closeSettings() {
    setSettingsOpen(false);
    setNotifOpen(false);
    setBannerOpen(false);
  }

  function openNotifModal() {
    setBannerOpen(false);
    setNotifOpen(true);
  }

  function closeNotifModal() {
    setNotifOpen(false);
  }

  function openBannerModal() {
    setNotifOpen(false);
    setBannerOpen(true);
  }

  function closeBannerModal() {
    setBannerOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    // Only close via the X button — do not close on outside click or when opening items.
    // Escape still closes for accessibility.
    function onKeyDown(e) { if (e.key === "Escape") closeMenu(); }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!settingsOpen && !notifOpen && !bannerOpen && !langModalOpen && !deviceModalOpen && !accentModalOpen && !appearanceModalOpen) return;
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      // Close topmost modal first
      if (appearanceModalOpen) { setAppearanceModalOpen(false); return; }
      if (accentModalOpen) { setAccentModalOpen(false); return; }
      if (deviceModalOpen) { setDeviceModalOpen(false); return; }
      if (langModalOpen) { setLangModalOpen(false); return; }
      if (notifOpen) { closeNotifModal(); return; }
      if (bannerOpen) { closeBannerModal(); return; }
      if (settingsOpen) closeSettings();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, notifOpen, bannerOpen, langModalOpen, deviceModalOpen, accentModalOpen, appearanceModalOpen]);

  // Lock background scroll for any open settings-style modal (click-outside still closes).
  useBodyScrollLock(open || settingsOpen || notifOpen || bannerOpen || langModalOpen || accentModalOpen || appearanceModalOpen);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => { setSettingsOpen(true); try { preloadSettingsHeavy(); } catch (_) {} }}
        title={T("Settings", "الإعدادات")}
        aria-label={T("Settings", "الإعدادات")}
        aria-expanded={settingsOpen}
        className="lift-hover touch-target header-settings-btn"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          border: "1px solid rgba(var(--border-rgb),0.22)",
          background: "color-mix(in srgb, var(--card) 70%, transparent)",
          color: "var(--icon-muted)",
          borderRadius: 12,
          cursor: "pointer",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
        }}
      >
        <SettingsIcon size={17} />
      </button>

      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        isAr={isAr}
        appLang={appLang}
        theme={theme}
        onToggleTheme={onToggleTheme}
        isAdmin={isAdmin}
        onOpenAccount={onOpenAccount}
        onOpenAdmin={onOpenAdmin}
        onLogout={onLogout}
        onOpenNotif={openNotifModal}
        onOpenBanner={openBannerModal}
        onOpenExamSettings={onOpenExamSettings}
        onOpenAchievements={onOpenAchievements}
        onEnableReminders={onEnableReminders}
        onDisableReminders={onDisableReminders}
        onPersistSiteBanner={onPersistSiteBanner}
        siteBanner={siteBanner}
        remindersOn={remindersOn}
        pendingCount={pendingCount}
        onOpenLang={() => setLangModalOpen(true)}
        onOpenDevice={() => setDeviceModalOpen(true)}
        onOpenAccent={() => setAccentModalOpen(true)}
        onOpenAppearance={() => setAppearanceModalOpen(true)}
        deviceMode={deviceMode}
        brandPresetId={brandPresetId}
        setBrandPresetId={setBrandPresetId}
        brandCustomGlyph={brandCustomGlyph}
        setBrandCustomGlyph={setBrandCustomGlyph}
        brandAddMode={brandAddMode}
        setBrandAddMode={setBrandAddMode}
        brandDraftCustom={brandDraftCustom}
        setBrandDraftCustom={setBrandDraftCustom}
        vaultAccounts={vaultAccounts}
        mainAccountCode={mainAccountCode}
        onSwitchAccount={onSwitchAccount}
        onSetMainAccount={onSetMainAccount}
        onUnlinkVaultAccount={onUnlinkVaultAccount}
        onLogoutAll={onLogoutAll}
        onLinkAccount={onLinkAccount}
        myAccountCode={myAccountCode}
      />

      <DeviceModeModal
        open={deviceModalOpen}
        onClose={() => setDeviceModalOpen(false)}
        isAr={isAr}
        appLang={appLang}
        deviceMode={deviceMode}
        onChangeDeviceMode={onChangeDeviceMode}
      />
      <LangModal
        open={langModalOpen}
        onClose={() => setLangModalOpen(false)}
        isAr={isAr}
        appLang={appLang}
        onChangeAppLang={onChangeAppLang}
      />
      <AccentModal
        open={accentModalOpen}
        onClose={() => setAccentModalOpen(false)}
        isAr={isAr}
        appLang={appLang}
      />

      <NotificationsModal
        open={notifOpen}
        onClose={closeNotifModal}
        isAr={isAr}
        appLang={appLang}
        remindersOn={remindersOn}
        remindersBusy={remindersBusy}
        onEnableReminders={onEnableReminders}
        onDisableReminders={onDisableReminders}
        onTestReminder={onTestReminder}
        onClearReminderSlots={onClearReminderSlots}
        reminderTitle={reminderTitle}
        onChangeReminderTitle={onChangeReminderTitle}
        reminderMessage={reminderMessage}
        onChangeReminderMessage={onChangeReminderMessage}
        reminderMessages={reminderMessages}
        onChangeReminderMessages={onChangeReminderMessages}
        reminderIntervalHours={reminderIntervalHours}
        onChangeReminderIntervalHours={onChangeReminderIntervalHours}
        isAdmin={isAdmin}
        myAccountCode={myAccountCode}
      />

      <SiteBannerAdminModal
        open={bannerOpen}
        onClose={closeBannerModal}
        siteBanner={siteBanner}
        onPersistSiteBanner={onPersistSiteBanner}
        isAr={isAr}
        appLang={appLang}
      />

      {/* Language settings — dedicated modal */}
      {/* Accent / dialect — dedicated modal */}
      {/* Appearance — theme + color scheme */}
      <AppearanceModal
        open={appearanceModalOpen}
        onClose={() => setAppearanceModalOpen(false)}
        isAr={isAr}
        appLang={appLang}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onChangeTheme={onChangeTheme}
        uiScale={uiScale}
        onChangeUiScale={onChangeUiScale}
        brandPresetId={brandPresetId}
        setBrandPresetId={setBrandPresetId}
        brandCustomGlyph={brandCustomGlyph}
        setBrandCustomGlyph={setBrandCustomGlyph}
        brandAddMode={brandAddMode}
        setBrandAddMode={setBrandAddMode}
        brandDraftCustom={brandDraftCustom}
        setBrandDraftCustom={setBrandDraftCustom}
        uiDensity={uiDensity}
        setUiDensity={setUiDensity}
        uiRadius={uiRadius}
        setUiRadius={setUiRadius}
        cardHeight={cardHeight}
        setCardHeight={setCardHeight}
        accentTheme={accentTheme}
        onChangeAccent={onChangeAccent}
        skin={skin}
        onChangeSkin={onChangeSkin}
        latinFont={latinFont}
        onChangeLatinFont={onChangeLatinFont}
        arabicFont={arabicFont}
        onChangeArabicFont={onChangeArabicFont}
        reducedMotion={reducedMotion}
        onChangeReducedMotion={onChangeReducedMotion}
        uiSounds={uiSounds}
        onChangeUiSounds={onChangeUiSounds}
        dirOverride={dirOverride}
        onChangeDirOverride={onChangeDirOverride}
        cardSurface={cardSurface}
        onChangeCardSurface={onChangeCardSurface}
        headerStyle={headerStyle}
        onChangeHeaderStyle={onChangeHeaderStyle}
        cardClarity={cardClarity}
        onChangeCardClarity={onChangeCardClarity}
        modalStyle={modalStyle}
        onChangeModalStyle={onChangeModalStyle}
        iconStyle={iconStyle}
        onChangeIconStyle={onChangeIconStyle}
        motionSpeed={motionSpeed}
        onChangeMotionSpeed={onChangeMotionSpeed}
        examVisual={examVisual}
        onChangeExamVisual={onChangeExamVisual}
      />

    </div>
  );
}
