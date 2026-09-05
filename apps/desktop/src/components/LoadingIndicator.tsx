interface LoadingIndicatorProps {
  label: string;
}

export function LoadingIndicator({ label }: LoadingIndicatorProps) {
  return (
    <div className="loading-indicator" role="status" aria-live="polite" aria-label={label}>
      <span className="loading-indicator-track" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="loading-indicator-label">{label}</span>
    </div>
  );
}
