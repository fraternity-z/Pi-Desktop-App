import { ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { normalizeThinkingLevels, type ThinkingLevel } from "../ipc/agent";
import "./composer-model-picker.css";

const EMPTY_LEVELS: ThinkingLevel[] = [];
const SLIDER_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

export function thinkingLevelLabel(level: ThinkingLevel): string {
  return { off: "关闭", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" }[level];
}

export function ComposerThinkingControl({
  modelName, level, availableLevels = EMPTY_LEVELS, disabled, loading, saving = false, error = null, onSelectModel, onChange,
}: {
  modelName: string;
  level: ThinkingLevel | null;
  availableLevels?: readonly ThinkingLevel[];
  disabled: boolean;
  loading: boolean;
  saving?: boolean;
  error?: string | null;
  onSelectModel: () => void;
  onChange: (level: ThinkingLevel) => void;
}) {
  const levels = useMemo(() => normalizeThinkingLevels(availableLevels), [availableLevels]);
  const confirmedLevel = level && levels.includes(level) ? level : levels[0] ?? null;
  const [draft, setDraft] = useState(confirmedLevel);
  const committedLevel = useRef(confirmedLevel);
  const sliderRef = useRef<HTMLInputElement>(null);
  const levelsKey = levels.join(",");
  useEffect(() => {
    if (disabled || saving) return;
    setDraft(confirmedLevel);
    committedLevel.current = confirmedLevel;
  }, [confirmedLevel, levelsKey, disabled, saving]);
  useEffect(() => { sliderRef.current?.focus(); }, []);

  const selectedLevel = draft && levels.includes(draft) ? draft : confirmedLevel;
  const index = selectedLevel ? levels.indexOf(selectedLevel) : 0;
  const lastIndex = levels.length - 1;
  const sliderDisabled = disabled || loading || levels.length <= 1;
  const label = selectedLevel ? thinkingLevelLabel(selectedLevel) : level ? thinkingLevelLabel(level) : "思考强度";

  function commit() {
    if (sliderDisabled || saving || !selectedLevel || selectedLevel === committedLevel.current) return;
    committedLevel.current = selectedLevel;
    onChange(selectedLevel);
  }

  return (
    <div className="composer-thinking-control" aria-busy={saving}>
      <button className="composer-model-card" type="button" aria-label="选择模型"
        aria-haspopup="menu" disabled={disabled} aria-disabled={saving || undefined}
        onClick={() => { if (!saving) onSelectModel(); }}>
        <strong>{label}</strong>
        <span><span>{modelName}</span><ChevronRight size={13} aria-hidden="true" /></span>
      </button>
      {loading ? (
        <p className="composer-menu-state" role="status"><LoaderCircle className="spin" size={15} aria-hidden="true" />正在读取思考强度</p>
      ) : error ? (
        <p className="composer-menu-state composer-menu-state-error" role="alert">{error}</p>
      ) : levels.length === 0 ? (
        <p className="composer-menu-state">此模型未提供思考强度</p>
      ) : (
        <div className="composer-thinking-slider" data-disabled={sliderDisabled}
          style={{ "--thinking-progress": `${lastIndex > 0 ? index / lastIndex * 100 : 0}%` } as CSSProperties}>
          <div className="composer-thinking-track" aria-hidden="true">
            <div className="composer-thinking-fill" />
            <div className="composer-thinking-stops">
              {levels.map((item, stop) => <span key={item} data-filled={stop <= index} title={thinkingLevelLabel(item)} />)}
            </div>
          </div>
          <input ref={sliderRef} type="range" min={0} max={Math.max(0, lastIndex)} step={1} value={index}
            aria-label="思考强度" aria-valuetext={label} disabled={sliderDisabled} aria-disabled={saving || undefined}
            onChange={(event) => {
              const next = levels[Number(event.currentTarget.value)];
              if (!sliderDisabled && !saving && next) setDraft(next);
            }}
            onPointerDown={(event) => {
              if (saving) event.preventDefault();
              else event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onKeyDown={(event) => { if (saving && SLIDER_KEYS.includes(event.key)) event.preventDefault(); }}
            onPointerUp={commit} onKeyUp={(event) => { if (SLIDER_KEYS.includes(event.key)) commit(); }}
            onBlur={commit} onPointerCancel={() => { if (!saving) setDraft(confirmedLevel); }} />
        </div>
      )}
    </div>
  );
}
