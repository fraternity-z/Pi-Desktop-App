import { CircleHelp } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const helpRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !helpRef.current || !tooltipRef.current) return;
    const anchor = helpRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 7;
    const below = anchor.bottom + gap;
    const top = below + tooltip.height <= window.innerHeight - margin
      ? below
      : anchor.top - tooltip.height - gap;
    setPosition({
      left: Math.max(margin, Math.min(anchor.left - 12, window.innerWidth - tooltip.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - tooltip.height - margin)),
    });
  }, [open, help]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const closeOutside = (event: PointerEvent) => {
      if (!helpRef.current?.contains(event.target as Node)
        && !tooltipRef.current?.contains(event.target as Node)) close();
    };
    const closeOnScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !tooltipRef.current?.contains(event.target)) close();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

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
            ref={helpRef}
            type="button"
            aria-label={`${title}说明`}
            aria-describedby={open ? id : undefined}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(true)}
          >
            <CircleHelp size={14} aria-hidden="true" />
          </button>
          {open && createPortal(
            <span
              ref={tooltipRef}
              className="general-setting-tooltip"
              role="tooltip"
              id={id}
              style={position}
            >
              {help}
            </span>,
            document.body,
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
