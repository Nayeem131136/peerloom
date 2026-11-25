"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useNode } from "../../lib/store";
import { bytes, clockSec } from "../../lib/format";
import { Empty, Icon, PageHead, Reveal, Spotlight } from "../../components/ui";

const PARTS = [
  { k: "length", w: 4, t: "Length", d: "4 bytes, big-endian. Size of everything after the header.", c: "a" },
  { k: "kind", w: 1, t: "Kind", d: "1 byte. 0 = JSON control message, 1 = raw file chunk.", c: "b" },
  { k: "body", w: 8, t: "Body", d: "JSON with a \"type\" field — or a 4-byte slot id followed by raw file bytes.", c: "c" },
];

export default function Protocol() {
  const { frames } = useNode();
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const [hover, setHover] = useState(null);
  const shown = frames.filter((f) => (filter === "all" ? true : filter === "quiet" ? f.type === "ping" || f.type === "pong" : f.type !== "ping" && f.type !== "pong")).slice(-60).reverse();

  return (
    <>
      <PageHead eyebrow="Protocol" title="The wire format">Peerloom speaks a tiny binary-framed protocol over TCP. Every frame below was really sent or received by this peer.</PageHead>

      <Reveal>
        <Spotlight className="anatomy">
          <div className="card-title"><span>Frame anatomy</span><span className="muted">protocol v2</span></div>
          <div className="bytes">
            {PARTS.map((p, i) => (
              <motion.div key={p.k} className={`seg ${p.c} ${hover === p.k ? "hot" : ""}`} style={{ flexGrow: p.w }}
                initial={{ opacity: 0, scaleX: 0.3 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 0.2 + i * 0.18, duration: 0.5 }}
                onMouseEnter={() => setHover(p.k)} onMouseLeave={() => setHover(null)}>
                <b>{p.t}</b><span>{p.w === 8 ? "N bytes" : `${p.w} B`}</span>
              </motion.div>
            ))}
          </div>
          <div className="seg-notes">{PARTS.map((p) => <p key={p.k} className={hover === p.k ? "hot" : ""}><i className={p.c} /><b>{p.t}</b> {p.d}</p>)}</div>
        </Spotlight>
      </Reveal>

      <Reveal delay={0.06}>
        <div className="insp-head">
          <h2 className="sec">Live frames</h2>
          <div className="seg-ctrl">{["all", "data", "quiet"].map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "quiet" ? "heartbeat" : f}{filter === f && <motion.span layoutId="segpill" className="pill" />}</button>
          ))}</div>
        </div>
        {shown.length === 0 ? <Empty icon={Icon.code} title="No frames yet">Connect to a peer and send a message — every frame is captured here.</Empty> : (
          <div className="frames card">
            <AnimatePresence initial={false}>
              {shown.map((f) => (
                <motion.div layout key={f.id} className="frame" initial={{ opacity: 0, y: -10, backgroundColor: "rgba(94,234,212,.18)" }} animate={{ opacity: 1, y: 0, backgroundColor: "rgba(94,234,212,0)" }} transition={{ duration: 0.6 }}>
                  <button onClick={() => setOpen(open === f.id ? null : f.id)}>
                    <span className={`dir ${f.dir}`}>{f.dir === "tx" ? "↑ out" : "↓ in"}</span>
                    <span className={`ftype ${f.kind}`}>{f.type}</span>
                    <span className="fpeer">{f.peerName || "—"}</span>
                    <code className="hex">{f.hex}</code>
                    <span className="fsize">{bytes(f.length)}</span>
                    <time>{clockSec(f.ts)}</time>
                  </button>
                  {open === f.id && (
                    <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}>{JSON.stringify(f.message, null, 2)}</motion.pre>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Reveal>
    </>
  );
}
