import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface MenuPoint {
  x: number;
  y: number;
}

export function pointFromElement(element: HTMLElement, align: "start" | "end" = "end"): MenuPoint {
  const rect = element.getBoundingClientRect();
  return { x: align === "end" ? rect.right : rect.left, y: rect.bottom + 4 };
}

export function FloatingMenu({
  point,
  width = 200,
  label,
  children,
  onClose,
}: {
  point: MenuPoint;
  width?: number;
  label: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.min(Math.max(margin, point.x - width), window.innerWidth - rect.width - margin),
      y: Math.min(Math.max(margin, point.y), window.innerHeight - rect.height - margin),
    });
  }, [point, width]);

  useEffect(() => {
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="floating-menu"
      role="menu"
      aria-label={label}
      style={{
        "--floating-menu-width": `${width}px`,
        left: position.x,
        top: position.y,
      } as CSSProperties}
    >
      {children}
    </div>,
    document.body,
  );
}

export function FloatingMenuItem({
  icon,
  label,
  detail,
  selected = false,
  danger = false,
  disabled = false,
  onSelect,
}: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="floating-menu-item"
      data-selected={selected || undefined}
      data-danger={danger || undefined}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="floating-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="floating-menu-label">{label}</span>
      {detail && <span className="floating-menu-detail">{detail}</span>}
    </button>
  );
}

export function FloatingMenuSeparator() {
  return <div className="floating-menu-separator" role="separator" />;
}

