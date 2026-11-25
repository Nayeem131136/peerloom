"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNode } from "../../lib/store";
import { clock } from "../../lib/format";
import { Avatar, Empty, Icon, PageHead } from "../../components/ui";

export default function Chat() {
  const { peers, messages, sendText, sendFile, toast, chat, setTarget, markRead, unread } = useNode();
  const target = chat.target;
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { if (target !== "all" && !peers.some((p) => p.id === target)) setTarget("all"); }, [peers, target, setTarget]);
  const thread = useMemo(() => messages.filter((m) => (target === "all" ? m.peerId === "all" : m.peerId === target || (m.dir === "in" && m.from === target && m.peerId !== "all"))), [messages, target]);
  useEffect(() => { const last = thread.filter((m) => m.dir === "in").at(-1); if (last) markRead(target, last.ts); }, [target, thread, markRead]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length]);

  const current = target === "all" ? { name: "Everyone", sub: `${peers.length} peer${peers.length === 1 ? "" : "s"}` } : peers.find((p) => p.id === target);

  const submit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    try { await sendText(target, value); setText(""); } catch {}
  };

  const drop = async (e) => {
    e.preventDefault(); setDrag(false);
    for (const file of e.dataTransfer.files) {
      try { await sendFile(target, file); toast("success", `Sending ${file.name}`); } catch {}
    }
  };

  return (
    <>
      <PageHead compact eyebrow="Chat" title="Talk directly">Messages travel straight to the other peer — each one confirmed with a delivery receipt.</PageHead>
      <div className="chat card">
        <aside className="convos">
          <button className={`convo ${target === "all" ? "on" : ""}`} onClick={() => setTarget("all")}>
            <span className="avatar all">{Icon.users}</span><span className="cn"><b>Everyone</b><small>Broadcast</small></span>
            {unread.all > 0 && <em className="count">{unread.all}</em>}
          </button>
          <AnimatePresence initial={false}>
            {peers.map((p) => (
              <motion.button layout key={p.id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className={`convo ${target === p.id ? "on" : ""}`} onClick={() => setTarget(p.id)}>
                <Avatar name={p.name} /><span className="cn"><b>{p.name}</b><small>{p.host}:{p.port}</small></span>
                {unread[p.id] > 0 && <motion.em key={unread[p.id]} initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="count">{unread[p.id]}</motion.em>}
              </motion.button>
            ))}
          </AnimatePresence>
        </aside>

        <section className={`thread ${drag ? "dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop}>
          <div className="thread-head">
            {target === "all" ? <span className="avatar all">{Icon.users}</span> : <Avatar name={current?.name} />}
            <div><b>{current?.name}</b><small>{target === "all" ? current.sub : "connected · direct TCP"}</small></div>
          </div>
          <div className="msgs">
            {peers.length === 0 ? (
              <Empty icon={Icon.net} title="No one to talk to yet">Connect to a peer from the Network page and your conversation appears here.</Empty>
            ) : thread.length === 0 ? (
              <Empty icon={Icon.chat} title="Say hello">Drop a file anywhere in this panel to send it too.</Empty>
            ) : (
              <AnimatePresence initial={false}>
                {thread.map((m) => (
                  <motion.div layout key={m.dir + m.id} className={`bubble ${m.dir}`}
                    initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}>
                    {m.dir === "in" && target === "all" && <span className="from">{m.fromName}</span>}
                    <p>{m.text}</p>
                    <span className="meta">{clock(m.ts)}
                      {m.dir === "out" && (
                        <motion.span key={m.status} initial={{ scale: 0.4 }} animate={{ scale: 1 }} className={`tick ${m.status}`} title={m.status}>
                          {m.status === "delivered" ? <>{Icon.check}{Icon.check}</> : Icon.check}
                        </motion.span>
                      )}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
            <div ref={endRef} />
          </div>
          <form className="composer" onSubmit={submit}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={peers.length ? `Message ${current?.name}…` : "Connect to a peer first"} disabled={!peers.length} maxLength={4000} />
            <motion.button className="btn primary icon" whileTap={{ scale: 0.9 }} disabled={!peers.length || !text.trim()} aria-label="Send">{Icon.send}</motion.button>
          </form>
          {drag && <div className="dropveil">Drop to send to {current?.name}</div>}
        </section>
      </div>
    </>
  );
}
