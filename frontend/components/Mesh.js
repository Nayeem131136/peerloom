"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useNode } from "../lib/store";
import { hue, initials } from "../lib/format";

const W = 640, H = 420, CX = W / 2, CY = H / 2;

function layout(peers, known) {
  const direct = peers.map((p, i) => {
    const a = (-Math.PI / 2) + (i / Math.max(1, peers.length)) * Math.PI * 2;
    return { ...p, x: CX + Math.cos(a) * 140, y: CY + Math.sin(a) * 120, a, direct: true };
  });
  const seen = new Set(peers.map((p) => p.id));
  const hidden = [];
  for (const [via, list] of Object.entries(known)) {
    for (const e of list) {
      if (seen.has(e.id) || hidden.some((h) => h.id === e.id)) continue;
      hidden.push({ ...e, via });
    }
  }
  const outer = hidden.map((p, i) => {
    const via = direct.find((d) => d.id === p.via);
    const base = via ? via.a : (i / Math.max(1, hidden.length)) * Math.PI * 2;
    const spread = (i - (hidden.length - 1) / 2) * 0.45;
    return { ...p, x: CX + Math.cos(base + spread) * 255, y: CY + Math.sin(base + spread) * 185, direct: false };
  });
  return { direct, outer };
}

const DEMO_PEERS = [
  { id: "d1", name: "Rafi", host: "192.168.0.12", port: 5001, rtt: 1.2 },
  { id: "d2", name: "Nila", host: "192.168.0.15", port: 5002, rtt: 2.8 },
  { id: "d3", name: "Sam", host: "192.168.0.21", port: 5003, rtt: 4.1 },
  { id: "d4", name: "Maya", host: "192.168.0.30", port: 5004, rtt: 3.3 },
];

export default function Mesh({ onPick, compact = false, selected, demo = false }) {
  const live = useNode();
  const { me, onFrame } = live;
  const peers = demo ? DEMO_PEERS : live.peers;
  const known = demo ? {} : live.known;
  const { direct, outer } = useMemo(() => layout(peers, known), [peers, known]);
  const [packets, setPackets] = useState([]);

  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => {
      const p = DEMO_PEERS[Math.floor(Math.random() * DEMO_PEERS.length)];
      const d = direct.find((x) => x.id === p.id);
      if (!d) return;
      const out = Math.random() > 0.5, id = `demo-${Math.random()}`;
      const from = out ? { x: CX, y: CY } : { x: d.x, y: d.y }, to = out ? { x: d.x, y: d.y } : { x: CX, y: CY };
      setPackets((cur) => [...cur.slice(-24), { id, from, to, kind: Math.random() > 0.7 ? "chunk" : "json", quiet: false }]);
      setTimeout(() => setPackets((cur) => cur.filter((x) => x.id !== id)), 1100);
    }, 520);
    return () => clearInterval(t);
  }, [demo, direct]);

  useEffect(() => demo ? undefined : onFrame((f) => {
    if (f.type === "ping" || f.type === "pong") { /* keep heartbeat subtle */ }
    const p = direct.find((d) => d.id === f.peerId);
    if (!p) return;
    const id = `${f.id}-${Math.random()}`;
    const from = f.dir === "tx" ? { x: CX, y: CY } : { x: p.x, y: p.y };
    const to = f.dir === "tx" ? { x: p.x, y: p.y } : { x: CX, y: CY };
    const quiet = f.type === "ping" || f.type === "pong";
    setPackets((cur) => [...cur.slice(-24), { id, from, to, kind: f.kind, type: f.type, quiet }]);
    setTimeout(() => setPackets((cur) => cur.filter((x) => x.id !== id)), 1100);
  }), [onFrame, direct]);

  return (
    <div className={`mesh ${compact ? "compact" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Peer mesh">
        <defs>
          <radialGradient id="meGlow"><stop offset="0" stopColor="var(--accent)" stopOpacity=".55" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
          <linearGradient id="thread" x1="0" x2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent2)" /></linearGradient>
        </defs>
        {[70, 130, 200, 270].map((r, i) => (
          <circle key={r} cx={CX} cy={CY} r={r} className="orbit" style={{ animationDelay: `${i * -3}s` }} />
        ))}
        {outer.map((p) => {
          const via = direct.find((d) => d.id === p.via);
          return via && <line key={`l${p.id}`} x1={via.x} y1={via.y} x2={p.x} y2={p.y} className="link ghost" />;
        })}
        {direct.map((p) => <line key={`d${p.id}`} x1={CX} y1={CY} x2={p.x} y2={p.y} className="link live" />)}

        <circle cx={CX} cy={CY} r="70" fill="url(#meGlow)" />
        <motion.circle cx={CX} cy={CY} initial={{ r: 30, opacity: 0.5 }} className="pulse" animate={{ r: [30, 52], opacity: [0.5, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: "easeOut" }} />
        <circle cx={CX} cy={CY} r="30" fill="url(#thread)" />
        <text x={CX} y={CY + 5} textAnchor="middle" className="node-text">{initials(me.name || "me")}</text>
        <text x={CX} y={CY + 52} textAnchor="middle" className="node-label">{demo ? "You" : `${me.name || "You"} (you)`}</text>

        <AnimatePresence>
          {outer.map((p) => (
            <motion.g key={`o${p.id}`} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }}
              style={{ transformOrigin: `${p.x}px ${p.y}px`, cursor: onPick ? "pointer" : "default" }}
              onClick={() => onPick?.({ ...p, discovered: true })}>
              <circle cx={p.x} cy={p.y} r="19" className="ghost-node" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" className="node-text small">{initials(p.name)}</text>
              <text x={p.x} y={p.y + 36} textAnchor="middle" className="node-label dim">{p.name}</text>
            </motion.g>
          ))}
          {direct.map((p) => (
            <motion.g key={`p${p.id}`} initial={{ opacity: 0, scale: 0.2 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.2 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              style={{ transformOrigin: `${p.x}px ${p.y}px`, cursor: onPick ? "pointer" : "default" }} onClick={() => onPick?.(p)}>
              <circle cx={p.x} cy={p.y} r="25" fill={`hsl(${hue(p.name)} 75% 55%)`} className={selected === p.id ? "sel" : ""} />
              <text x={p.x} y={p.y + 5} textAnchor="middle" className="node-text">{initials(p.name)}</text>
              <text x={p.x} y={p.y + 44} textAnchor="middle" className="node-label">{p.name}</text>
              {p.rtt != null && <text x={p.x} y={p.y + 58} textAnchor="middle" className="node-label dim">{p.rtt} ms</text>}
            </motion.g>
          ))}
        </AnimatePresence>

        {packets.map((k) => (
          <motion.circle key={k.id} r={k.quiet ? 2.5 : k.kind === "chunk" ? 5 : 4.5}
            className={`packet ${k.quiet ? "quiet" : k.kind === "chunk" ? "chunk" : "json"}`}
            initial={{ cx: k.from.x, cy: k.from.y, opacity: 1 }} animate={{ cx: k.to.x, cy: k.to.y, opacity: [1, 1, 0] }}
            transition={{ duration: 0.9, ease: "easeInOut" }} />
        ))}
      </svg>
      {!demo && peers.length === 0 && <div className="mesh-hint">No peers yet — connect to another peer to weave the mesh.</div>}
    </div>
  );
}
