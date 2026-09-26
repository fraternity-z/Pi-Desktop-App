import { CircleHelp } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { ProxyMode } from "../ipc/proxy";
import "./GeneralSettings.css";

export function GeneralSettingsRow({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="general-setting-row">
      <div className="general-setting-label">
        <span>{title}</span>
        <span
          className="general-setting-help"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            aria-label={`${title}说明`}
            aria-describedby={open ? id : undefined}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            <CircleHelp size={14} aria-hidden="true" />
          </button>
          {open && (
            <span className="general-setting-tooltip" role="tooltip" id={id}>
              {help}
            </span>
          )}
        </span>
      </div>
      <div className="general-setting-control">{children}</div>
    </div>
  );
}

export function ProxyModeControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value?: ProxyMode;
  disabled: boolean;
  onChange: (mode: ProxyMode) => void;
}) {
  const id = useId();
  return (
    <div
      className="general-proxy-segments"
      role="radiogroup"
      aria-label={label}
    >
      {(
        [
          { value: "system", label: "系统" },
          { value: "direct", label: "直连" },
          { value: "custom", label: "自定义" },
        ] as const
      ).map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
