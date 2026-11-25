"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";

const DEFAULT_API = 8801;
const Ctx = createContext(null);
export const useNode = () => useContext(Ctx);

const initial = {
  link: "connecting", // connecting | online | offline
  me: { running: false },
  peers: [], known: {}, messages: [], transfers: {}, files: [], frames: [], activity: [],
  stats: { peers: 0, messagesSent: 0, messagesReceived: 0, bytesIn: 0, bytesOut: 0, filesSent: 0, filesReceived: 0, uptime: 0, avgRtt: null },
  toasts: [],
};

function reducer(s, a) {
  switch (a.type) {
    case "link": return { ...s, link: a.value };
    case "snapshot": {
      const d = a.data;
      return { ...s, link: "online", me: d.me, peers: d.peers, known: d.known, messages: d.messages,
        transfers: Object.fromEntries(d.transfers.map((t) => [t.id, t])), files: d.files,
        frames: d.frames, activity: d.activity, stats: d.stats };
    }
    case "me": return { ...s, me: a.data };
    case "peers": return { ...s, peers: a.data.peers, known: a.data.known };
    case "message": return s.messages.some((m) => m.id === a.data.id && m.dir === a.data.dir) ? s
      : { ...s, messages: [...s.messages, a.data].slice(-400) };
    case "message_update": return { ...s, messages: s.messages.map((m) => (m.id === a.data.id && m.dir === "out" ? { ...m, ...a.data } : m)) };
    case "transfer": return { ...s, transfers: { ...s.transfers, [a.data.id]: a.data } };
    case "file": return { ...s, files: [a.data, ...s.files.filter((f) => f.name !== a.data.name)] };
    case "frame": return { ...s, frames: [...s.frames, a.data].slice(-200) };
    case "activity": return { ...s, activity: [a.data, ...s.activity].slice(0, 60) };
    case "stats": return { ...s, stats: a.data };
    case "toast": return { ...s, toasts: [...s.toasts, a.data].slice(-4) };
    case "untoast": return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    default: return s;
  }
}

export function NodeProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const base = useRef(`http://127.0.0.1:${DEFAULT_API}`);
  const frameListeners = useRef(new Set());
  const [chat, setChat] = useState({ target: "all", readAt: {} });
  const setTarget = useCallback((target) => setChat((c) => ({ ...c, target })), []);
  const markRead = useCallback((id, ts) => setChat((c) => (ts && ts > (c.readAt[id] || 0) ? { ...c, readAt: { ...c.readAt, [id]: ts } } : c)), []);

  const toast = useCallback((level, text) => {
    const id = Math.random().toString(36).slice(2);
    dispatch({ type: "toast", data: { id, level, text } });
    setTimeout(() => dispatch({ type: "untoast", id }), 4200);
  }, []);

  useEffect(() => {
    let port = DEFAULT_API;
    try {
      const q = new URLSearchParams(window.location.search).get("node");
      if (q && /^\d+$/.test(q)) sessionStorage.setItem("peerloom.api", q);
      port = Number(sessionStorage.getItem("peerloom.api")) || DEFAULT_API;
    } catch {}
    base.current = `http://127.0.0.1:${port}`;

    const es = new EventSource(`${base.current}/api/events`);
    es.onopen = () => dispatch({ type: "link", value: "online" });
    es.onerror = () => dispatch({ type: "link", value: es.readyState === 2 ? "offline" : "connecting" });
    for (const type of ["snapshot", "me", "peers", "message", "message_update", "transfer", "file", "frame", "activity", "stats"]) {
      es.addEventListener(type, (e) => {
        const data = JSON.parse(e.data);
        dispatch({ type, data });
        if (type === "frame") frameListeners.current.forEach((fn) => fn(data));
      });
    }
    return () => es.close();
  }, []);

  const call = useCallback(async (path, body, silent) => {
    try {
      const res = await fetch(`${base.current}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      return json;
    } catch (err) {
      const msg = err instanceof TypeError ? "Cannot reach the Peerloom backend. Is it running?" : err.message;
      if (!silent) toast("error", msg);
      throw new Error(msg);
    }
  }, [toast]);

  const actions = useMemo(() => ({
    toast,
    apiBase: () => base.current,
    onFrame: (fn) => { frameListeners.current.add(fn); return () => frameListeners.current.delete(fn); },
    start: (name, port) => call("/api/start", { name, port: Number(port) }),
    stop: () => call("/api/stop"),
    connect: async (host, port) => {
      const peer = await call("/api/connect", { host, port: Number(port) });
      toast("success", `Connected to ${peer.name}`);
      return peer;
    },
    disconnect: (id) => call("/api/disconnect", { id }),
    sendText: (to, text) => call("/api/messages", { to, text }),
    sendFile: async (to, file) => {
      const res = await fetch(`${base.current}/api/files?to=${encodeURIComponent(to)}&name=${encodeURIComponent(file.name)}`, {
        method: "POST", body: file,
      }).catch(() => { throw new Error("Cannot reach the Peerloom backend"); });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast("error", json.error || "Upload failed"); throw new Error(json.error); }
      return json;
    },
    downloadUrl: (name) => `${base.current}/api/files/${encodeURIComponent(name)}`,
  }), [call, toast]);

  const unread = useMemo(() => {
    const out = {};
    for (const m of state.messages) {
      if (m.dir === "in" && m.ts > (chat.readAt[m.peerId] || 0)) out[m.peerId] = (out[m.peerId] || 0) + 1;
    }
    return out;
  }, [state.messages, chat.readAt]);
  const unreadTotal = useMemo(() => Object.values(unread).reduce((a, b) => a + b, 0), [unread]);

  const value = useMemo(() => ({ ...state, ...actions, chat, setTarget, markRead, unread, unreadTotal }), [state, actions, chat, setTarget, markRead, unread, unreadTotal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
