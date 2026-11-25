"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { useNode } from "../../lib/store";
import { bytes, clock, speed } from "../../lib/format";
import { Empty, Icon, PageHead, Reveal, Ring, Spotlight } from "../../components/ui";

export default function Files() {
  const { peers, transfers, files, sendFile, downloadUrl, toast } = useNode();
  const [target, setTarget] = useState("all");
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const list = useMemo(() => Object.values(transfers).sort((a, b) => b.ts - a.ts), [transfers]);

  const send = async (fileList) => {
    for (const file of fileList) {
      try { await sendFile(target, file); toast("success", `Sending ${file.name}`); } catch {}
    }
  };

  return (
    <>
      <PageHead eyebrow="Files" title="Send anything, verified">Files stream in 48 KiB chunks while chat keeps flowing. The receiver checks the SHA-256 before saving.</PageHead>

      <Spotlight className={`drop ${drag ? "on" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
        onClick={() => peers.length && input.current?.click()}>
        <motion.span className="drop-ico" animate={{ y: drag ? -8 : [0, -5, 0] }} transition={drag ? {} : { repeat: Infinity, duration: 2.6 }}>{Icon.up}</motion.span>
        <h3>{drag ? "Release to send" : "Drop files here or click to choose"}</h3>
        <label className="to" onClick={(e) => e.stopPropagation()}>Send to
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="all">Everyone ({peers.length})</option>
            {peers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {!peers.length && <small className="warn">Connect to a peer first (Network page).</small>}
        <input ref={input} type="file" multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
      </Spotlight>

      <div className="grid-2 top">
        <Reveal>
          <section>
            <h2 className="sec">Transfers</h2>
            {list.length === 0 ? <Empty icon={Icon.file} title="No transfers yet">Sent and received files show up here with live progress.</Empty> : (
              <div className="tlist">
                <AnimatePresence initial={false}>
                  {list.map((t) => {
                    const pct = t.size ? t.done / t.size : 1;
                    return (
                      <motion.div layout key={t.id} className={`transfer ${t.status}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                        <Ring value={t.status === "done" ? 1 : pct}>{t.status === "done" ? Icon.check : t.status === "failed" ? Icon.x : `${Math.round(pct * 100)}`}</Ring>
                        <div className="tinfo">
                          <b title={t.name}>{t.name}</b>
                          <small>{t.dir === "out" ? "to" : "from"} {t.peerName} · {bytes(t.size)}{t.status === "active" ? ` · ${speed(t.speed)}` : ""}</small>
                          <div className="bar"><motion.i animate={{ width: `${(t.status === "done" ? 1 : pct) * 100}%` }} /></div>
                        </div>
                        <span className={`chip ${t.status}`}>{t.status === "done" ? "SHA-256 ✓" : t.status === "failed" ? (t.error || "failed") : t.status === "verifying" ? "verifying…" : t.dir === "out" ? "sending" : "receiving"}</span>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>
        </Reveal>

        <Reveal delay={0.08}>
          <section>
            <h2 className="sec">Received files</h2>
            {files.length === 0 ? <Empty icon={Icon.down} title="Nothing received yet">Files saved from peers appear here, ready to download.</Empty> : (
              <ul className="flist">
                <AnimatePresence initial={false}>
                  {files.map((f) => (
                    <motion.li layout key={f.name} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                      <span className="fi">{Icon.file}</span>
                      <div><b>{f.name}</b><small>{bytes(f.size)} · {f.from ? `from ${f.from} · ` : ""}{clock(f.mtime)}</small>{f.sha256 && <code title={f.sha256}>sha256 {f.sha256.slice(0, 16)}…</code>}</div>
                      <a className="btn ghost sm" href={downloadUrl(f.name)} download>Save</a>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>
        </Reveal>
      </div>
    </>
  );
}
