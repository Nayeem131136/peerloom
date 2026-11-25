"use client";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { hue, initials } from "../lib/format";

export function CountUp({ value, format = (n) => Math.round(n).toLocaleString() }) {
  const [shown, setShown] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const controls = animate(prev.current, value ?? 0, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: setShown });
    prev.current = value ?? 0;
    return () => controls.stop();
  }, [value]);
  return <>{format(shown)}</>;
}

export function Spotlight({ children, className = "", as: Tag = "div", ...rest }) {
  const ref = useRef(null);
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return <Tag ref={ref} onMouseMove={move} className={`card spot ${className}`} {...rest}>{children}</Tag>;
}

export function Avatar({ name, size = 36, ring }) {
  const h = hue(name);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36,
      background: `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 50) % 360} 80% 48%))`,
      boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 4px hsl(${h} 80% 60% / .6)` : undefined }}>
      {initials(name)}
    </span>
  );
}

export function Reveal({ children, delay = 0, y = 22, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}

export function PageHead({ eyebrow, title, children, compact }) {
  return (
    <header className={`pagehead ${compact ? "compact" : ""}`}>
      <motion.span className="eyebrow" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>{eyebrow}</motion.span>
      <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>{title}</motion.h1>
      {children && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>{children}</motion.p>}
    </header>
  );
}

export function Empty({ icon, title, children }) {
  return (
    <div className="empty">
      <motion.div className="empty-icon" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3.2, ease: "easeInOut" }}>{icon}</motion.div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Ring({ value, size = 44, stroke = 4, children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeWidth={stroke} fill="none"
          strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - Math.min(1, value)) }} transition={{ duration: 0.3 }}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-label">{children}</span>
    </span>
  );
}

export const Icon = {
  home: <svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" /></svg>,
  chat: <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /></svg>,
  file: <svg viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6zM14 3v5h5" /></svg>,
  net: <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M11 7l-5 9M13 7l5 9M7 18h10" /></svg>,
  code: <svg viewBox="0 0 24 24"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5M13.5 5l-3 14" /></svg>,
  send: <svg viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8z" /></svg>,
  up: <svg viewBox="0 0 24 24"><path d="M12 16V4m-5 5l5-5 5 5M4 20h16" /></svg>,
  down: <svg viewBox="0 0 24 24"><path d="M12 4v12m-5-5l5 5 5-5M4 20h16" /></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg>,
  x: <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>,
  bolt: <svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
  users: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6M16 5a3.5 3.5 0 010 6.5M18 14c2.2.5 3.5 2.5 3.8 6" /></svg>,
  copy: <svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></svg>,
};
