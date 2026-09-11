import { useEffect, useRef, useState } from "react";

const STREAM_STEP_MS = 28;
const MAX_PENDING_GRAPHEMES = 240;

type GraphemeSegmenter = { segment: (text: string) => Iterable<{ segment: string }> };
const Segmenter = (Intl as typeof Intl & {
  Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter;
}).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

function splitGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

function skipAnimation(): boolean {
  return document.hidden || document.documentElement.dataset.reduceMotion === "true" ||
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Smooth only presentation; the session store remains the authoritative complete text. */
export function useStreamingText(content: string, active: boolean): string {
  const [displayed, setDisplayed] = useState(() => active && !skipAnimation() ? "" : content);
  const visible = useRef(displayed);
  const target = useRef(content);
  const timer = useRef<number | null>(null);
  const streaming = useRef(active);

  useEffect(() => {
    if (!active) return;
    function clearTimer() {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    }
    function flush() {
      clearTimer();
      visible.current = target.current;
      setDisplayed(target.current);
    }
    function onPreferencesChange() {
      if (skipAnimation()) flush();
    }
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motion?.addEventListener?.("change", onPreferencesChange);
    document.addEventListener("visibilitychange", onPreferencesChange);
    const observer = new MutationObserver(onPreferencesChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    return () => {
      clearTimer();
      motion?.removeEventListener?.("change", onPreferencesChange);
      document.removeEventListener("visibilitychange", onPreferencesChange);
      observer.disconnect();
    };
  }, [active]);

  useEffect(() => {
    const replaced = !content.startsWith(target.current);
    target.current = content;
    streaming.current = active;
    if (!active || replaced || skipAnimation()) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      visible.current = content;
      setDisplayed(content);
      return;
    }
    function advance() {
      timer.current = null;
      const remaining = splitGraphemes(target.current.slice(visible.current.length));
      // Catch up large bursts without holding hundreds of stale animation frames.
      const count = Math.max(1, Math.ceil(remaining.length / 8), remaining.length - MAX_PENDING_GRAPHEMES);
      visible.current = !streaming.current || skipAnimation()
        ? target.current
        : visible.current + remaining.slice(0, count).join("");
      setDisplayed(visible.current);
      if (visible.current !== target.current) timer.current = window.setTimeout(advance, STREAM_STEP_MS);
    }
    if (visible.current !== content && timer.current === null) {
      timer.current = window.setTimeout(advance, STREAM_STEP_MS);
    }
  }, [active, content]);

  return !active || !content.startsWith(displayed) || skipAnimation() ? content : displayed;
}
