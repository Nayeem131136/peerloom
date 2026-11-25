"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useNode } from "../../lib/store";
import { bytes, uptime } from "../../lib/format";
import { Avatar, Empty, Icon, PageHead, Reveal, Spotlight } from "../../components/ui";
import Mesh from "../../components/Mesh";

export default function Network() {
  const { me, peers, known, connect, disconnect } = useNode();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  const go = async (h, p) => {
    setBusy(true);
    try { await connect(h, p); setPort(""); } catch {} finally { setBusy(false); }
  };
  const submit = (e) => { e.preventDefault(); go(host, port); };
  const pick = (p) => { setSelected(p.id); if (p.discovered) { setHost(p.host); setPort(String(p.port)); } };
  const discovered = Object.values(known).flat().filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i && !peers.some((p) => p.id === e.id));

  return (
    <>
      <PageHead eyebrow="Network" title="Your mesh">Peers you connect to tell you who else they know, so the mesh grows without a directory server.</PageHead>

      <div className="grid-hero">
        <Spotlight className="hero-mesh">
          <div className="card-title"><span>Topology</span>
            <span className="legend"><i className="lg json" />message <i className="lg chunk" />file data <i className="lg quiet" />heartbeat</span></div>
          <Mesh onPick={pick} selected={selected} />
        </Spotlight>

        <div className="stack">
          <Spotlight>
            <div className="card-title"><span>Connect to a peer</span></div>
            <form onSubmit={submit} className="connect-form">
              <label>IP address<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.0.12" required /></label>
              <label>Port<input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" pattern="[0-9]*" placeholder="5001" required /></label>
              <motion.button className="btn primary" whileTap={{ scale: 0.97 }} disabled={busy}>{busy ? "Connecting…" : "Connect"}</motion.button>
            </form>
            <small className="hint">You are listening on port {me.port}. Same computer? Use 127.0.0.1 and the other peer's port.</small>
          </Spotlight>

          <AnimatePresence>
            {discovered.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <Spotlight>
                  <div className="card-title"><span>Discovered via peers</span><span className="badge">{discovered.length}</span></div>
                  <ul className="disc">
                    {discovered.map((d) => (
                      <li key={d.id}><Avatar name={d.name} size={30} /><div><b>{d.name}</b><small>{d.host}:{d.port}</small></div>
                        <button className="btn ghost sm" disabled={busy} onClick={() => go(d.host, d.port)}>Connect</button></li>
                    ))}
                  </ul>
                </Spotlight>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Reveal>
        <h2 className="sec">Connected peers</h2>
        {peers.length === 0 ? <Empty icon={Icon.net} title="No connections yet">Enter another peer's address above to join its mesh.</Empty> : (
          <div className="table card">
            <div className="tr th"><span>Peer</span><span>Address</span><span>Latency</span><span>Traffic</span><span>Online</span><span /></div>
            <AnimatePresence initial={false}>
              {peers.map((p) => (
                <motion.div layout key={p.id} className={`tr ${selected === p.id ? "sel" : ""}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  <span className="who"><Avatar name={p.name} size={30} /><b>{p.name}</b></span>
                  <span data-l="Address"><code>{p.host}:{p.port}</code></span>
                  <span data-l="Latency"><b className="rtt">{p.rtt == null ? "…" : `${p.rtt} ms`}</b></span>
                  <span data-l="Traffic">↓ {bytes(p.bytesIn)} · ↑ {bytes(p.bytesOut)}</span>
                  <span data-l="Online">{uptime(Date.now() / 1000 - p.since)}</span>
                  <span><button className="btn ghost sm danger" onClick={() => disconnect(p.id)}>Disconnect</button></span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Reveal>
    </>
  );
}
