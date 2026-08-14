import { useMemo, useState, useCallback } from "react";
import { tr } from "../../lib/config/i18n";
import { BRASS, labelStyle } from "../../lib/config/theme";

/**
 * Shared multi-unit scope for Academic section practice / exam tools.
 * Returns filtered entries + UI for presets + per-unit toggles.
 */
export function useUnitScope(academicUnits, activeUnitId, entries) {
  const hasUnits = Array.isArray(academicUnits) && academicUnits.length > 0;
  const sortedUnits = useMemo(() => {
    if (!hasUnits) return [];
    return [...academicUnits].sort(
      (a, b) =>
        (a.order || 0) - (b.order || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );
  }, [hasUnits, academicUnits]);

  const [selectedUnitIds, setSelectedUnitIds] = useState(() => {
    if (!Array.isArray(academicUnits) || !academicUnits.length) return null;
    const id = activeUnitId || academicUnits[0]?.id;
    return id ? new Set([id]) : new Set(academicUnits.map((u) => u.id));
  });

  const unitFilteredEntries = useMemo(() => {
    if (!hasUnits || !selectedUnitIds) return entries || [];
    return (entries || []).filter(
      (e) => selectedUnitIds.has(e.unitId) || selectedUnitIds.has(e.unitId || null)
    );
  }, [entries, hasUnits, selectedUnitIds]);

  const setUnitPreset = useCallback(
    (count) => {
      if (!sortedUnits.length) return;
      setSelectedUnitIds(new Set(sortedUnits.slice(0, count).map((u) => u.id)));
    },
    [sortedUnits]
  );

  const toggleUnit = useCallback((id) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) {
        if (next.size <= 1) return next;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllUnits = useCallback(() => {
    setSelectedUnitIds(new Set(sortedUnits.map((u) => u.id)));
  }, [sortedUnits]);

  return {
    hasUnits,
    sortedUnits,
    selectedUnitIds,
    setSelectedUnitIds,
    unitFilteredEntries,
    setUnitPreset,
    toggleUnit,
    selectAllUnits,
  };
}

/**
 * Visual unit picker (presets + chips). Only renders when hasUnits is true.
 */
export default function UnitScopePicker({
  isAr,
  hasUnits,
  sortedUnits,
  selectedUnitIds,
  entries,
  setUnitPreset,
  toggleUnit,
  selectAllUnits,
  accent = BRASS,
  accentSoft = "rgba(184, 148, 58, 0.12)",
  onChange,
}) {
  if (!hasUnits || !sortedUnits.length) return null;

  const chipStyle = (active) => ({
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: active ? "#fff" : "var(--icon-muted)",
    background: active ? accent : "none",
    border: `1px solid ${active ? accent : "rgba(var(--border-rgb),0.25)"}`,
    borderRadius: 20,
    cursor: "pointer",
  });

  const presets = [
    { n: 3, label: tr(isAr, "First 3", "أول 3") },
    { n: 6, label: tr(isAr, "First 6", "أول 6") },
    { n: 12, label: tr(isAr, "First 12", "أول 12") },
    { n: sortedUnits.length, label: tr(isAr, "All units", "كل الوحدات") },
  ].filter(
    (p, i, arr) =>
      p.n > 0 &&
      p.n <= sortedUnits.length &&
      arr.findIndex((x) => x.n === p.n) === i
  );

  function handlePreset(n) {
    if (n >= sortedUnits.length) selectAllUnits();
    else setUnitPreset(n);
    if (typeof onChange === "function") onChange();
  }

  function handleToggle(id) {
    toggleUnit(id);
    if (typeof onChange === "function") onChange();
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{tr(isAr, "Units", "الوحدات")}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 6 }}>
        {presets.map((p) => {
          const active =
            selectedUnitIds &&
            selectedUnitIds.size === Math.min(p.n, sortedUnits.length) &&
            sortedUnits.slice(0, p.n).every((u) => selectedUnitIds.has(u.id));
          return (
            <button
              key={p.n}
              type="button"
              onClick={() => handlePreset(p.n)}
              style={chipStyle(!!active)}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {sortedUnits.map((u) => {
          const active = selectedUnitIds ? selectedUnitIds.has(u.id) : false;
          const count = (entries || []).filter((e) => (e.unitId || null) === u.id).length;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => handleToggle(u.id)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
                border: active ? `1.5px solid ${accent}` : "1px solid rgba(var(--border-rgb),0.25)",
                background: active ? accentSoft : "transparent",
                color: active ? accent : "var(--icon-muted)",
                cursor: "pointer",
              }}
            >
              {u.name}
              <span style={{ marginInlineStart: 5, opacity: 0.75, fontSize: 11 }}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
