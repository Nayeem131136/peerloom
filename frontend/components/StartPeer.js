"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { useNode } from "../lib/store";
import Mesh from "./Mesh";

export default function StartPeer() {
  const { start } = useNode();
  const [name, setName] = useState("");
  const [port, setPort] = useState("5000");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await start(name, port); } catch {} finally { setBusy(false); }
  };

  return (
    <div className="onboard">
      <motion.div className="onboard-copy" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
        <span className="eyebrow">Serverless · direct · verified</span>
        <h1>Weave your own<br /><span className="grad">peer-to-peer mesh.</span></h1>
        <p>Chat and send files straight between computers over plain TCP. No server in the middle, no accounts, no cloud.</p>
        <form onSubmit={submit} className="start-form">
          <label>Display name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Rafi" autoFocus required /></label>
          <label>Listening port<input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" pattern="[0-9]*" required /></label>
          <motion.button className="btn primary" whileTap={{ scale: 0.97 }} disabled={busy}>{busy ? "Starting…" : "Start my peer"}</motion.button>
        </form>
        <small className="hint">Tip: a friend on the same Wi-Fi connects to your IP and this port.</small>
      </motion.div>
      <motion.div className="onboard-art" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.15 }}>
        <Mesh demo />
      </motion.div>
    </div>
  );
}
