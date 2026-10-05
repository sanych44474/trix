// Two small celebrations for the session summary: numbers that count up, and a short confetti
// burst for a record, a level-up or a badge. Both skip themselves under prefers-reduced-motion.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Counts a whole number up from 0 over ~0.7s; anything else (12:30, 85%) renders as is. */
export function CountUp({ value }: { value: string }) {
  const target = /^\d+$/.test(value) ? Number(value) : null;
  const [shown, setShown] = useState(target === null || reducedMotion() ? value : "0");
  useEffect(() => {
    if (target === null || reducedMotion()) { setShown(value); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      setShown(String(Math.round(target * (1 - Math.pow(1 - p, 3)))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, target]);
  return <>{shown}</>;
}

const COLORS = ["var(--accent)", "#ffd166", "#06d6a0", "#4cc9f0", "#f72585"];

export function Confetti() {
  const [done, setDone] = useState(reducedMotion());
  const pieces = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    dx: `${Math.round((Math.random() - 0.5) * 360)}px`,
    dy: `${Math.round(160 + Math.random() * 260)}px`,
    rot: `${Math.round((Math.random() - 0.5) * 720)}deg`,
    delay: `${Math.round(Math.random() * 120)}ms`,
    color: COLORS[i % COLORS.length],
  })), []);
  useEffect(() => { const id = setTimeout(() => setDone(true), 1700); return () => clearTimeout(id); }, []);
  if (done) return null;
  // Portalled to <body>: inside an animating card a fixed overlay would be positioned (and
  // clipped) against that card until its entrance animation ends.
  return createPortal(
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => <i key={i} style={{ background: p.color, animationDelay: p.delay, ["--dx" as string]: p.dx, ["--dy" as string]: p.dy, ["--rot" as string]: p.rot }} />)}
    </div>,
    document.body,
  );
}
