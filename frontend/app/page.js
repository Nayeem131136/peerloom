"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useNode } from "../lib/store";
import { bytes, clockSec, uptime } from "../lib/format";
import { CountUp, Icon, PageHead, Reveal, Spotlight } from "../components/ui";
import Mesh from "../components/Mesh";

export default function Overview() {
  const { me, stats, activity, peers, stop, toast } = useNode();
  const copy = (text) => { navigator.clipboard?.writeText(text); toast("success", "Copied " + text); };

  const tiles = [
    { label: "Peers online", value: stats.peers, icon: Icon.users },
    { label: "Messages", value: stats.messagesSent + stats.messagesReceived, icon: Icon.chat },
    { label: "Files verified", value: stats.filesSent + stats.filesReceived, icon: Icon.shield },
    { label: "Avg latency", value: stats.avgRtt ?? 0, icon: Icon.bolt, fmt: (n) => (stats.avgRtt == null ? "–" : `${n.toFixed(1)} ms`) },
  ];

  return (
    <>
      <PageHead eyebrow="Overview" title={`Hello, ${me.name}`}>
        Your peer is live. Share an address below so others can connect straight to you.
      </PageHead>

      <div className="grid-hero">
        <Spotlight className="hero-mesh">
          <div className="card-title"><span>Live mesh</span><Link href="/network" className="link-btn">Open network →</Link></div>
          <Mesh compact />
        </Spotlight>

        <div className="stack">
          <Spotlight>
            <div className="card-title"><span>Your address</span><span className="badge live"><i />listening</span></div>
            <div className="addr-list">
              {(me.addresses?.length ? me.addresses : ["127.0.0.1"]).map((ip) => (
                <button key={ip} className="addr" onClick={() => copy(`${ip}:${me.port}`)}>
                  <code>{ip}<em>:{me.port}</em></code><span className="ni">{Icon.copy}</span>
                </button>
              ))}
            </div>
            <div className="kv"><span>Uptime</span><b>{uptime(stats.uptime)}</b></div>
            <div className="kv"><span>Traffic</span><b>↓ {bytes(stats.bytesIn)} · ↑ {bytes(stats.bytesOut)}</b></div>
            <button className="btn ghost wide" onClick={() => stop()}>Stop peer</button>
          </Spotlight>
        </div>
      </div>

      <div className="tiles">
        {tiles.map((t, i) => (
          <Reveal key={t.label} delay={i * 0.07}>
            <Spotlight className="tile">
              <span className="tile-ico">{t.icon}</span>
              <b className="tile-num"><CountUp value={t.value} format={t.fmt} /></b>
              <span className="tile-label">{t.label}</span>
            </Spotlight>
          </Reveal>
        ))}
      </div>

      <div className="grid-2">
        <Reveal>
          <Spotlight>
            <div className="card-title"><span>Quick actions</span></div>
            <div className="actions">
              <Link href="/network" className="action"><span className="ni">{Icon.net}</span><div><b>Connect to a peer</b><small>Enter an IP and port</small></div></Link>
              <Link href="/chat" className="action"><span className="ni">{Icon.chat}</span><div><b>Start chatting</b><small>Direct or to everyone</small></div></Link>
              <Link href="/files" className="action"><span className="ni">{Icon.up}</span><div><b>Send a file</b><small>SHA-256 verified</small></div></Link>
              <Link href="/protocol" className="action"><span className="ni">{Icon.code}</span><div><b>Inspect the wire</b><small>Live frames, in hex</small></div></Link>
            </div>
          </Spotlight>
        </Reveal>
        <Reveal delay={0.08}>
          <Spotlight>
            <div className="card-title"><span>Activity</span></div>
            <ul className="feed">
              {activity.length === 0 && <li className="muted">Nothing yet.</li>}
              {activity.slice(0, 7).map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className={a.level}>
                  <i /><span>{a.text}</span><time>{clockSec(a.ts)}</time>
                </motion.li>
              ))}
            </ul>
          </Spotlight>
        </Reveal>
      </div>

      <Reveal>
        <section className="how">
          <h2>How it works</h2>
          <div className="steps">
            {[["1", "Listen", "Every peer opens a TCP port and accepts connections."],
              ["2", "Handshake", "Peers swap identities and protocol versions; duplicates and self-links are refused."],
              ["3", "Exchange", "Length-prefixed frames carry chat, heartbeats, and file chunks side by side."],
              ["4", "Verify", "Each file's SHA-256 is checked before it is saved. Corruption is rejected."]].map(([n, t, d]) => (
              <div key={n} className="step"><span>{n}</span><b>{t}</b><p>{d}</p></div>
            ))}
          </div>
        </section>
      </Reveal>
    </>
  );
}
