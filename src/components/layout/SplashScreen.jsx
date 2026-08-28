/**
 * Bacaloria Community — Alexander the Great themed splash / loading screen.
 * Dark bronze + gold martial aesthetic with real progress bar.
 */
import { useEffect, useState, useRef } from "react";

const QUOTE_AR = "لا أخاف جيشًا من الأسود يقوده خروف، بل أخاف جيشًا من الخراف يقوده أسد";
const QUOTE_EN =
  "I am not afraid of an army of lions led by a sheep; I am afraid of an army of sheep led by a lion.";
const QUOTE_LA =
  "Non timeo exercitum leonum duce ove; timeo exercitum ovium duce leone.";
const NAME_AR = "الإسكندر الأكبر";
const NAME_EN = "Alexander the Great";

/**
 * @param {{
 *   onComplete?: () => void;
 *   minMs?: number;
 *   forceProgress?: number | null;
 *   isAr?: boolean;
 *   blocking?: boolean;
 * }} props
 * blocking: true = indeterminate sweep (force-refresh); never freeze at 100%.
 */
export default function SplashScreen({
  onComplete,
  minMs = 1800,
  forceProgress = null,
  isAr = true,
  blocking = false,
}) {
  const [progress, setProgress] = useState(blocking ? null : 0);
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());
  const completedRef = useRef(false);

  useEffect(() => {
    if (blocking) {
      setProgress(null);
      return;
    }
    if (forceProgress != null && Number.isFinite(forceProgress)) {
      setProgress(Math.max(0, Math.min(100, forceProgress)));
      return;
    }

    let raf;
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const t = Math.min(1, elapsed / minMs);
      const eased = 1 - Math.pow(1 - t, 2.4);
      // Stay under 100 until we intentionally finish — avoids a stuck 100% bar.
      const p = Math.min(96, Math.round(eased * 96));
      setProgress(p);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [minMs, forceProgress, blocking]);

  useEffect(() => {
    if (blocking) return;
    if (forceProgress != null && forceProgress >= 100 && !completedRef.current) {
      completedRef.current = true;
      setProgress(100);
      setDone(true);
      const t = setTimeout(() => onComplete?.(), 280);
      return () => clearTimeout(t);
    }
  }, [forceProgress, blocking, onComplete]);

  useEffect(() => {
    if (blocking || forceProgress != null) return;
    if (progress >= 96 && !completedRef.current) {
      const elapsed = Date.now() - startRef.current;
      const remain = Math.max(0, minMs - elapsed);
      const t = setTimeout(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        setProgress(100);
        setDone(true);
        setTimeout(() => onComplete?.(), 320);
      }, remain + 120);
      return () => clearTimeout(t);
    }
  }, [progress, minMs, forceProgress, blocking, onComplete]);

  const label =
    blocking
      ? isAr
        ? "جاري التحديث…"
        : "Updating…"
      : progress == null
        ? isAr
          ? "جاري التحميل…"
          : "Loading…"
        : isAr
          ? `جاري التحميل… ${progress}%`
          : `Loading… ${progress}%`;

  const fillWidth =
    blocking || progress == null
      ? undefined
      : `${Math.max(4, Math.min(100, progress))}%`;

  return (
    <div
      className="alex-splash"
      role="status"
      aria-live="polite"
      aria-label={isAr ? "شاشة التحميل — باكالوريا كوميونيتي" : "Loading — Bacaloria Community"}
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="alex-inner">
        <div className="alex-wrap">
          <div className="alex-glow" />
          <img
            className="alex-portrait"
            src="/alexander-portrait.jpg"
            alt={isAr ? NAME_AR : NAME_EN}
            width={184}
            height={184}
            decoding="async"
          />
        </div>

        <p className="alex-name">{isAr ? NAME_AR : NAME_EN}</p>
        <p className="alex-quote">{isAr ? QUOTE_AR : QUOTE_EN}</p>
        {!isAr && <p className="alex-latin">{QUOTE_LA}</p>}
        {isAr && <p className="alex-sub">{QUOTE_EN}</p>}
        {isAr && <p className="alex-latin">{QUOTE_LA}</p>}

        <div className="alex-progress" aria-hidden="true">
          <div
            className={`alex-fill ${blocking || progress == null ? "alex-fill--indeterminate" : ""}`}
            style={fillWidth != null ? { width: fillWidth } : undefined}
          />
        </div>
        <p className="alex-status">{label}</p>
      </div>

      <style>{`
        .alex-splash {
          min-height: 100dvh;
          display: grid;
          place-items: center;
          padding: 1.5rem;
          box-sizing: border-box;
          color: #e8e0d0;
          font-family: system-ui, "Segoe UI", "Noto Sans Arabic", Tahoma, sans-serif;
          background:
            radial-gradient(ellipse 90% 55% at 50% 0%, rgba(160, 90, 30, 0.14), transparent 52%),
            radial-gradient(ellipse 70% 40% at 50% 100%, rgba(50, 20, 10, 0.45), transparent 50%),
            linear-gradient(165deg, #241c14 0%, #12100c 42%, #080706 100%);
        }
        .alex-inner {
          width: 100%;
          max-width: 22rem;
          text-align: center;
          animation: alexIn 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .alex-wrap {
          position: relative;
          width: 11.5rem;
          height: 11.5rem;
          margin: 0 auto 1.15rem;
          border-radius: 50%;
          padding: 5px;
          background: #0c0a08;
          box-shadow:
            0 0 0 1px rgba(0,0,0,0.55),
            0 18px 44px -10px rgba(0,0,0,0.8),
            0 0 56px -6px rgba(180,100,30,0.22);
        }
        .alex-wrap::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          padding: 5px;
          background: conic-gradient(from 30deg, #6b4a0e, #e4c56a, #a67c1a, #3d2a08, #e4c56a, #6b4a0e);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          animation: alexFrameSpin 14s linear infinite;
          pointer-events: none;
        }
        .alex-wrap::after {
          content: "";
          position: absolute;
          inset: -11px;
          border-radius: 50%;
          border: 1px solid rgba(201,162,39,0.18);
          pointer-events: none;
        }
        .alex-glow {
          position: absolute;
          inset: -22%;
          border-radius: 50%;
          z-index: -1;
          background: radial-gradient(circle, rgba(201,120,40,0.2), transparent 68%);
          animation: alexGlow 3s ease-in-out infinite;
        }
        .alex-portrait {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          object-position: center 12%;
          display: block;
          border: 3px solid #0c0a08;
          background: #1a120c;
          animation: alexBreath 5.5s ease-in-out infinite;
        }
        .alex-name {
          margin: 0 0 0.85rem;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 1.05rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: rgba(232,224,208,0.72);
        }
        .alex-quote {
          margin: 0 0 0.4rem;
          font-size: 1.02rem;
          font-weight: 700;
          line-height: 1.65;
          color: #f0e8d8;
        }
        .alex-sub {
          margin: 0 0 0.3rem;
          font-family: Georgia, serif;
          font-size: 0.8rem;
          font-style: italic;
          color: #c9a227;
          line-height: 1.45;
        }
        .alex-latin {
          margin: 0.15rem 0 1.25rem;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 0.76rem;
          font-style: italic;
          color: rgba(201, 162, 39, 0.78);
          letter-spacing: 0.015em;
          line-height: 1.5;
          max-width: 20rem;
          margin-left: auto;
          margin-right: auto;
        }
        .alex-progress {
          width: min(210px, 72%);
          height: 7px;
          margin: 0.7rem auto 0;
          position: relative;
          background: linear-gradient(to bottom, #1a120c, #0c0906);
          border: 1px solid rgba(180, 130, 40, 0.45);
          border-radius: 2px;
          box-shadow:
            inset 0 1px 3px rgba(0,0,0,0.7),
            0 0 0 1px rgba(0,0,0,0.4),
            0 0 18px -4px rgba(160, 100, 30, 0.2);
          overflow: hidden;
        }
        .alex-progress::before {
          content: "";
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            90deg,
            transparent 0px,
            transparent 11px,
            rgba(201, 162, 39, 0.07) 11px,
            rgba(201, 162, 39, 0.07) 12px
          );
          pointer-events: none;
        }
        .alex-progress::after {
          content: "";
          position: absolute;
          top: -3px;
          bottom: -3px;
          left: -2px;
          right: -2px;
          border-left: 2px solid rgba(201, 162, 39, 0.5);
          border-right: 2px solid rgba(201, 162, 39, 0.5);
          border-radius: 1px;
          pointer-events: none;
          opacity: 0.7;
        }
        .alex-fill {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 4%;
          background: linear-gradient(
            90deg,
            #8a6a18 0%,
            #c9a227 30%,
            #f0e0a0 50%,
            #e4c56a 70%,
            #c9a227 100%
          );
          border-radius: 1px;
          box-shadow:
            0 0 14px 2px rgba(201, 162, 39, 0.55),
            inset 0 1px 0 rgba(255, 240, 180, 0.35);
          transition: width 0.18s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .alex-fill--indeterminate {
          width: 38% !important;
          animation: alexSweep 1.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        .alex-status {
          margin: 1.05rem 0 0;
          font-size: 0.72rem;
          color: rgba(232, 224, 208, 0.42);
          letter-spacing: 0.06em;
        }
        @keyframes alexIn {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes alexGlow {
          0%, 100% { opacity: 0.5; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.06); }
        }
        @keyframes alexFrameSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes alexBreath {
          0%, 100% { transform: scale(1) translateY(0); }
          50% { transform: scale(1.025) translateY(-3px); }
        }
        @keyframes alexSweep {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .alex-wrap::before,
          .alex-portrait,
          .alex-glow,
          .alex-fill--indeterminate {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
