import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function ComposerProjectBar({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const left = maximum > 1 && viewport.scrollLeft > 1;
    const right = viewport.scrollLeft < maximum - 1;
    setEdges((current) =>
      current.left === left && current.right === right ? current : { left, right },
    );
  }, []);

  useLayoutEffect(measure, [children, measure]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      // Scroll offsets can be fractional while clientWidth and scrollWidth are rounded.
      if (maximum <= 1 || (event.deltaY < 0 && viewport.scrollLeft <= 1) || (event.deltaY > 0 && viewport.scrollLeft >= maximum - 1)) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      const next = Math.max(0, Math.min(maximum, viewport.scrollLeft + event.deltaY * unit));
      if (next === viewport.scrollLeft) return;
      event.preventDefault();
      viewport.scrollLeft = next;
      measure();
    };

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(track);
    viewport.addEventListener("scroll", measure, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      viewport.removeEventListener("scroll", measure);
      viewport.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div className="composer-project-bar">
      <div
        ref={scrollRef}
        className="composer-project-scroll"
        role="group"
        aria-label="项目上下文"
        tabIndex={0}
        data-overflow-left={edges.left}
        data-overflow-right={edges.right}
        onKeyDown={(event) => {
          // Portaled menu key events also bubble here; leave those controls alone.
          if (!event.currentTarget.contains(event.target as Node) || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const viewport = event.currentTarget;
          const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
          if (maximum === 0) return;
          event.preventDefault();
          viewport.scrollLeft = Math.max(0, Math.min(maximum, viewport.scrollLeft + (event.key === "ArrowRight" ? 80 : -80)));
          measure();
        }}
      >
        <div ref={trackRef} className="composer-project-track">{children}</div>
      </div>
    </div>
  );
}
