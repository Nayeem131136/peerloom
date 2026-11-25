"use client";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useNode } from "../lib/store";
import { Icon } from "./ui";
import StartPeer from "./StartPeer";

const NAV = [
  { href: "/", label: "Overview", icon: Icon.home },
  { href: "/chat", label: "Chat", icon: Icon.chat },
  { href: "/files", label: "Files", icon: Icon.file },
  { href: "/network", label: "Network", icon: Icon.net },
  { href: "/protocol", label: "Protocol", icon: Icon.code },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="logo-mark" aria-hidden>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#a78bfa" /></linearGradient></defs>
      <path d="M4 9c8 0 8 14 16 14s8-14 8-14M4 23c8 0 8-14 16-14s8 14 8 14" fill="none" stroke="url(#lg)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="4" cy="9" r="2.4" fill="#5eead4" /><circle cx="28" cy="23" r="2.4" fill="#a78bfa" />
    </svg>
  );
}

export default function Shell({ children }) {
  const path = usePathname();
  const { link, me, stats, toasts, unreadTotal } = useNode();
  const [open, setOpen] = useState(false);
  const gate = !me.running && path !== "/protocol" && link === "online";

  return (
    <div className="shell">
      <div className="aurora" aria-hidden><i /><i /><i /></div>
      <aside className={`side ${open ? "open" : ""}`}>
        <Link href="/" className="brand" onClick={() => setOpen(false)}><Logo /><span>Peer<b>loom</b></span></Link>
        <nav>
          <LayoutGroup id="nav">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
                  {active && <motion.span layoutId="navpill" className="pill" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                  <span className="ni">{n.icon}</span><span className="nl">{n.label}</span>
                  {n.href === "/chat" && unreadTotal > 0 && (
                    <motion.em key={unreadTotal} className="nbadge" initial={{ scale: 0.3 }} animate={{ scale: 1 }}>{unreadTotal > 99 ? "99+" : unreadTotal}</motion.em>
                  )}
                </Link>
              );
            })}
          </LayoutGroup>
        </nav>
        <div className="side-foot">
          <div className={`status ${link}`}>
            <span className="dot" />
            {link === "online" ? (me.running ? `${me.name} · :${me.port}` : "Backend online") : link === "connecting" ? "Connecting…" : "Backend offline"}
          </div>
          {me.running && <div className="peercount">{stats.peers} peer{stats.peers === 1 ? "" : "s"} connected</div>}
        </div>
      </aside>
      <button className="burger" aria-label="Menu" onClick={() => setOpen((o) => !o)}><span /><span /><span /></button>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <main className="main">
        {link === "offline" ? <Offline /> : gate ? <StartPeer /> : children}
      </main>

      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 24, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }} className={`toast ${t.level}`}>
              <span className="ti">{t.level === "error" ? Icon.x : Icon.check}</span>{t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Offline() {
  return (
    <div className="center-card card">
      <h2>Waiting for the Peerloom backend</h2>
      <p>The dashboard could not reach the local service. Start it with the run script, then this page reconnects by itself.</p>
      <pre>.\run.bat        # Windows{"\n"}./run.sh         # macOS / Linux</pre>
    </div>
  );
}
