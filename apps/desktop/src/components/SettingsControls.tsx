import type { ReactNode } from "react";

export function SettingsSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section-block">
      <div className="settings-section-heading">
        <h2>{label}</h2>
        {action}
      </div>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  control,
  last = false,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`settings-row${last ? " settings-row-last" : ""}`}>
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

export function SettingsToggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className="settings-toggle"
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function SettingsSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="settings-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
