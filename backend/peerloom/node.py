"""
The Peerloom node: one TCP server + any number of TCP clients, all in one process.

Threads
-------
accept thread        waits for incoming connections
reader thread        one per connection - blocks in recv() so peers never wait for each other
heartbeat thread     pings every peer and drops the ones that went silent
uploader threads     one per outgoing file, so chat keeps flowing while files move
"""
import hashlib
import itertools
import os
import socket
import threading
import time
import uuid
from collections import deque

from . import protocol as P
from .util import local_addresses, safe_filename, unique_path

HANDSHAKE_TIMEOUT = 5.0
HEARTBEAT_EVERY = 5.0
SILENCE_LIMIT = 20.0
MAX_TEXT = 4000
MAX_FILE_BYTES = 8 * 1024 ** 3
PROGRESS_EVERY = 0.08


class NodeError(ValueError):
    """A user-level problem (bad input, peer not connected, ...)."""


class Connection:
    def __init__(self, node, sock, host):
        self.node = node
        self.sock = sock
        self.host = host
        self.peer_id = None
        self.name = None
        self.port = None                       # the peer's *listening* port
        self.since = time.time()
        self.last_seen = time.time()
        self.rtt = None
        self.bytes_in = 0
        self.bytes_out = 0
        self.closed = False
        self.send_lock = threading.Lock()
        self.incoming = {}                     # slot -> receive state
        self._slots = itertools.count(1)
        self._logged_chunks = set()

    def next_slot(self):
        return next(self._slots)

    def _write(self, data):
        with self.send_lock:                   # one writer at a time -> frames never interleave mid-frame
            self.sock.sendall(data)
        self.bytes_out += len(data)
        self.node._count_bytes(out=len(data))

    def send_json(self, message):
        data = P.encode_json(message)
        self._write(data)
        self.node._log_frame("tx", self, P.KIND_JSON, data, message)

    def send_chunk(self, slot, payload, first=False):
        data = P.encode_chunk(slot, payload)
        self._write(data)
        if first:
            self.node._log_frame("tx", self, P.KIND_CHUNK, data, {"type": "file_chunk", "slot": slot, "bytes": len(payload)})

    def close(self):
        self.closed = True
        for how in (socket.SHUT_RDWR,):
            try:
                self.sock.shutdown(how)
            except OSError:
                pass
        try:
            self.sock.close()
        except OSError:
            pass

    def info(self):
        return {
            "id": self.peer_id, "name": self.name, "host": self.host, "port": self.port,
            "rtt": None if self.rtt is None else round(self.rtt, 1),
            "since": self.since, "bytesIn": self.bytes_in, "bytesOut": self.bytes_out,
        }


class Node:
    def __init__(self, hub, downloads_root="downloads", throttle_kbps=0):
        self.hub = hub
        self.downloads_root = downloads_root
        self.throttle_kbps = throttle_kbps
        self.lock = threading.RLock()
        self._stats_lock = threading.Lock()
        self._reset_state()
        self.running = False

    # ------------------------------------------------------------ state
    def _reset_state(self):
        self.name = None
        self.port = None
        self.peer_id = None
        self.started_at = None
        self.server = None
        self.downloads_dir = None
        self.conns = {}
        self.known = {}
        self.messages = []
        self.transfers = {}
        self.file_info = {}
        self.frames = deque(maxlen=300)
        self.activity = deque(maxlen=120)
        self._progress_at = {}
        self._frame_seq = itertools.count(1)
        self._counters = {"messagesSent": 0, "messagesReceived": 0, "bytesIn": 0, "bytesOut": 0,
                          "filesSent": 0, "filesReceived": 0}
        self._stop = threading.Event()

    def _count_bytes(self, inn=0, out=0):
        with self._stats_lock:
            self._counters["bytesIn"] += inn
            self._counters["bytesOut"] += out

    def _bump(self, key, amount=1):
        with self._stats_lock:
            self._counters[key] += amount

    def me(self):
        return {
            "running": self.running, "name": self.name, "peerId": self.peer_id, "port": self.port,
            "startedAt": self.started_at, "addresses": local_addresses() if self.running else [],
            "downloadsDir": self.downloads_dir,
        }

    def peers_payload(self):
        with self.lock:
            return {"peers": [c.info() for c in self.conns.values()], "known": dict(self.known)}

    def stats(self):
        with self.lock:
            rtts = [c.rtt for c in self.conns.values() if c.rtt is not None]
            peers = len(self.conns)
        with self._stats_lock:
            out = dict(self._counters)
        out.update({"peers": peers, "uptime": 0 if not self.started_at else time.time() - self.started_at,
                    "avgRtt": round(sum(rtts) / len(rtts), 1) if rtts else None})
        return out

    def snapshot(self):
        with self.lock:
            data = {
                "me": self.me(), **self.peers_payload(),
                "messages": self.messages[-300:],
                "transfers": sorted(self.transfers.values(), key=lambda t: t["ts"]),
                "frames": list(self.frames)[-150:],
                "activity": list(self.activity),
            }
        data["files"] = self.list_files()
        data["stats"] = self.stats()
        return data

    def _activity(self, level, text):
        item = {"id": uuid.uuid4().hex[:8], "ts": time.time(), "level": level, "text": text}
        self.activity.appendleft(item)
        self.hub.publish("activity", item)

    def _log_frame(self, direction, conn, kind, data, message):
        record = {
            "id": next(self._frame_seq), "ts": time.time(), "dir": direction,
            "peerId": conn.peer_id, "peerName": conn.name,
            "kind": "json" if kind == P.KIND_JSON else "chunk",
            "type": (message or {}).get("type", "?"), "length": len(data),
            "hex": P.hex_preview(data), "message": message,
        }
        self.frames.append(record)
        self.hub.publish("frame", record)

    # ------------------------------------------------------------ lifecycle
    def start(self, name, port):
        name = (name or "").strip()
        if not 1 <= len(name) <= 24:
            raise NodeError("Name must be 1-24 characters")
        if not isinstance(port, int) or not 0 <= port <= 65535:
            raise NodeError("Port must be a number between 1 and 65535")
        with self.lock:
            if self.running:
                raise NodeError("This peer is already running")
            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if os.name != "nt":                                # on Windows SO_REUSEADDR would let two peers share a port
                server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                server.bind(("0.0.0.0", port))
            except OSError as exc:
                server.close()
                raise NodeError(f"Port {port} is not available ({exc.strerror or exc})")
            server.listen(16)
            server.settimeout(0.5)
            self._reset_state()
            self.server = server
            self.name = name
            self.port = server.getsockname()[1]
            self.peer_id = uuid.uuid4().hex[:8]
            self.started_at = time.time()
            self.downloads_dir = os.path.abspath(os.path.join(self.downloads_root, f"port-{self.port}"))
            os.makedirs(self.downloads_dir, exist_ok=True)
            self.running = True
        threading.Thread(target=self._accept_loop, args=(server,), name="accept", daemon=True).start()
        threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True).start()
        self._activity("success", f"Peer {name} is listening on port {self.port}")
        self.hub.publish("me", self.me())
        self.hub.publish("peers", self.peers_payload())

    def stop(self):
        with self.lock:
            if not self.running:
                return
            self.running = False
            self._stop.set()
            conns = list(self.conns.values())
            server = self.server
        for conn in conns:
            try:
                conn.send_json(P.bye())
            except (OSError, P.ProtocolError):
                pass
            conn.close()
        try:
            server.close()
        except OSError:
            pass
        with self.lock:
            self.conns.clear()
            self.known.clear()
        self._activity("info", "Peer stopped")
        self.hub.publish("me", self.me())
        self.hub.publish("peers", self.peers_payload())

    # ------------------------------------------------------------ accepting
    def _accept_loop(self, server):
        while self.running and server is self.server:
            try:
                sock, addr = server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._serve_incoming, args=(sock, addr[0]), daemon=True).start()

    def _serve_incoming(self, sock, host):
        conn = Connection(self, sock, host)
        try:
            sock.settimeout(HANDSHAKE_TIMEOUT)
            kind, body, size = P.read_frame(sock)
            conn.bytes_in += size
            self._count_bytes(inn=size)
            if kind != P.KIND_JSON:
                raise P.ProtocolError("expected hello")
            msg = P.parse_json(body)
            if msg.get("type") != P.HELLO:
                raise P.ProtocolError("expected hello")
            self._identify(conn, msg)
            self._log_frame("rx", conn, kind, body, msg)
            refusal = self._refusal_for(conn)
            if refusal:
                conn.send_json(P.error(*refusal))
                conn.close()
                return
            conn.send_json(P.hello_ack(self.peer_id, self.name, self.port))
            sock.settimeout(None)
            self._register(conn)
        except (OSError, P.ProtocolError, KeyError, TypeError, ValueError):
            conn.close()
            return
        self._read_loop(conn)

    def _identify(self, conn, msg):
        if msg.get("proto") != P.PROTOCOL_VERSION:
            raise P.ProtocolError("unsupported protocol version")
        conn.peer_id = str(msg["id"])[:16]
        conn.name = str(msg["name"]).strip()[:24] or "peer"
        conn.port = int(msg["port"])
        if not 0 < conn.port < 65536:
            raise ValueError("bad port")

    def _refusal_for(self, conn):
        if conn.peer_id == self.peer_id:
            return ("self", "You cannot connect a peer to itself")
        with self.lock:
            if not self.running:
                return ("closed", "That peer is not accepting connections")
            if conn.peer_id in self.conns:
                return ("duplicate", "Already connected to this peer")
        return None

    # ------------------------------------------------------------ connecting out
    def connect(self, host, port):
        host = (host or "").strip()
        if not host:
            raise NodeError("Enter the IP address of the other peer")
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise NodeError("Port must be a number between 1 and 65535")
        with self.lock:
            if not self.running:
                raise NodeError("Start your peer first")
        try:
            sock = socket.create_connection((host, port), timeout=HANDSHAKE_TIMEOUT)
        except socket.timeout:
            raise ConnectionError(f"Timed out connecting to {host}:{port} - check the IP, the port and the firewall")
        except ConnectionRefusedError:
            raise ConnectionError(f"Connection refused by {host}:{port} - is the other peer started on that port?")
        except OSError as exc:
            raise ConnectionError(f"Could not reach {host}:{port} ({exc.strerror or exc})")

        conn = Connection(self, sock, sock.getpeername()[0])
        try:
            conn.send_json(P.hello(self.peer_id, self.name, self.port))
            kind, body, size = P.read_frame(sock)
            conn.bytes_in += size
            self._count_bytes(inn=size)
            msg = P.parse_json(body) if kind == P.KIND_JSON else {}
            if msg.get("type") == P.ERROR:
                raise ConnectionError(msg.get("message", "Connection refused by the other peer"))
            if msg.get("type") != P.HELLO_ACK:
                raise P.ProtocolError("expected hello_ack")
            self._identify(conn, msg)
            self._log_frame("rx", conn, kind, body, msg)
            refusal = self._refusal_for(conn)
            if refusal:
                raise ConnectionError(refusal[1])
            sock.settimeout(None)
            self._register(conn)
        except (OSError, P.ProtocolError, KeyError, TypeError, ValueError) as exc:
            conn.close()
            if isinstance(exc, ConnectionError):
                raise
            raise ConnectionError(f"Handshake with {host}:{port} failed ({exc})")
        threading.Thread(target=self._read_loop, args=(conn,), daemon=True).start()
        return conn.info()

    def disconnect(self, peer_id):
        with self.lock:
            conn = self.conns.get(peer_id)
        if conn is None:
            raise NodeError("That peer is not connected")
        try:
            conn.send_json(P.bye("disconnected by user"))
        except (OSError, P.ProtocolError):
            pass
        self._drop(conn, "disconnected")

    # ------------------------------------------------------------ registry
    def _register(self, conn):
        with self.lock:
            self.conns[conn.peer_id] = conn
        self._activity("success", f"Connected to {conn.name} ({conn.host}:{conn.port})")
        self.hub.publish("peers", self.peers_payload())
        self._broadcast_peer_lists()

    def _drop(self, conn, reason):
        with self.lock:
            if conn.closed and self.conns.get(conn.peer_id) is not conn:
                return
            was_registered = self.conns.get(conn.peer_id) is conn
            if was_registered:
                del self.conns[conn.peer_id]
                self.known.pop(conn.peer_id, None)
        conn.close()
        for state in list(conn.incoming.values()):
            self._abort_incoming(conn, state, "connection lost")
        conn.incoming.clear()
        with self.lock:
            for t in self.transfers.values():
                if t["peerId"] == conn.peer_id and t["status"] in ("queued", "active", "verifying"):
                    self._finish_transfer(t, "failed", error="Connection lost")
        if was_registered and self.running:
            self._activity("warn", f"{conn.name} disconnected ({reason})")
            self.hub.publish("peers", self.peers_payload())
            self._broadcast_peer_lists()

    def _broadcast_peer_lists(self):
        with self.lock:
            conns = list(self.conns.values())
        for target in conns:
            entries = [{"id": c.peer_id, "name": c.name, "host": c.host, "port": c.port}
                       for c in conns if c is not target]
            try:
                target.send_json(P.peers(entries))
            except (OSError, P.ProtocolError):
                pass

    # ------------------------------------------------------------ receiving
    def _read_loop(self, conn):
        reason = "connection closed"
        try:
            while self.running and not conn.closed:
                kind, body, size = P.read_frame(conn.sock)
                conn.bytes_in += size
                conn.last_seen = time.time()
                self._count_bytes(inn=size)
                if kind == P.KIND_JSON:
                    message = P.parse_json(body)
                    self._log_frame("rx", conn, kind, body, message)
                    self._dispatch(conn, message)
                else:
                    self._receive_chunk(conn, body, size)
        except P.ConnectionClosed:
            pass
        except P.ProtocolError as exc:
            reason = f"protocol error: {exc}"
        except OSError:
            pass
        finally:
            self._drop(conn, reason)

    def _dispatch(self, conn, msg):
        kind = msg.get("type")
        if kind == P.TEXT:
            self._receive_text(conn, msg)
        elif kind == P.ACK:
            self._receive_ack(conn, msg)
        elif kind == P.PING:
            conn.send_json(P.pong(msg.get("t")))
        elif kind == P.PONG:
            sent = msg.get("t")
            if isinstance(sent, (int, float)):
                conn.rtt = max(0.0, (time.time() - sent) * 1000)
        elif kind == P.PEERS:
            entries = [e for e in msg.get("peers", []) if isinstance(e, dict) and e.get("id") != self.peer_id][:50]
            clean = [{"id": str(e["id"])[:16], "name": str(e.get("name", "peer"))[:24],
                      "host": str(e.get("host", ""))[:64], "port": int(e.get("port", 0))} for e in entries if "id" in e]
            with self.lock:
                self.known[conn.peer_id] = clean
            self.hub.publish("peers", self.peers_payload())
        elif kind == P.FILE_START:
            self._begin_receive(conn, msg)
        elif kind == P.FILE_ACK:
            self._receive_file_ack(conn, msg)
        elif kind == P.BYE:
            raise P.ConnectionClosed(msg.get("reason", "bye"))
        elif kind == P.ERROR:
            self._activity("warn", f"{conn.name}: {msg.get('message', 'error')}")

    # ------------------------------------------------------------ text
    def _add_message(self, message):
        with self.lock:
            self.messages.append(message)
            if len(self.messages) > 1000:
                del self.messages[:200]
        self.hub.publish("message", message)

    def _receive_text(self, conn, msg):
        body = str(msg.get("text", ""))[:MAX_TEXT]
        mid = str(msg.get("id", uuid.uuid4().hex[:12]))[:24]
        scope = "all" if msg.get("scope") == "all" else "direct"
        self._add_message({
            "id": mid, "dir": "in", "peerId": "all" if scope == "all" else conn.peer_id,
            "from": conn.peer_id, "fromName": conn.name, "text": body, "ts": time.time(),
            "status": "received", "deliveredTo": [], "total": 0,
        })
        self._bump("messagesReceived")
        conn.send_json(P.ack(mid))

    def _receive_ack(self, conn, msg):
        mid = msg.get("id")
        with self.lock:
            target = next((m for m in reversed(self.messages) if m["id"] == mid and m["dir"] == "out"), None)
            if target is None:
                return
            if conn.peer_id not in target["deliveredTo"]:
                target["deliveredTo"].append(conn.peer_id)
            if len(target["deliveredTo"]) >= target["total"]:
                target["status"] = "delivered"
            update = {"id": mid, "status": target["status"], "deliveredTo": list(target["deliveredTo"])}
        self.hub.publish("message_update", update)

    def send_text(self, target, text):
        text = (text or "").strip()
        if not text:
            raise NodeError("Type a message first")
        if len(text) > MAX_TEXT:
            raise NodeError(f"Message is too long (max {MAX_TEXT} characters)")
        conns = self._targets(target)
        mid = uuid.uuid4().hex[:12]
        scope = "all" if target == "all" else "direct"
        message = {"id": mid, "dir": "out", "peerId": target, "from": self.peer_id, "fromName": self.name,
                   "text": text, "ts": time.time(), "status": "sent", "deliveredTo": [], "total": len(conns)}
        self._add_message(message)
        self._bump("messagesSent")
        failures = 0
        for conn in conns:
            try:
                conn.send_json(P.text(mid, text, scope))
            except (OSError, P.ProtocolError):
                failures += 1
        if failures == len(conns):
            raise NodeError("Message could not be sent - the peer disconnected")
        return message

    def _targets(self, target):
        with self.lock:
            if not self.running:
                raise NodeError("Start your peer first")
            if target == "all":
                conns = list(self.conns.values())
                if not conns:
                    raise NodeError("No peers are connected yet")
                return conns
            conn = self.conns.get(target)
        if conn is None:
            raise NodeError("That peer is not connected")
        return [conn]

    # ------------------------------------------------------------ transfers (shared)
    def _new_transfer(self, conn, direction, name, size, sha256):
        transfer = {
            "id": uuid.uuid4().hex[:12], "peerId": conn.peer_id, "peerName": conn.name, "dir": direction,
            "name": name, "size": size, "done": 0, "status": "queued", "sha256": sha256, "verified": None,
            "ts": time.time(), "started": None, "ended": None, "speed": 0, "error": None, "savedAs": None,
        }
        with self.lock:
            self.transfers[transfer["id"]] = transfer
        self.hub.publish("transfer", dict(transfer))
        return transfer

    def _emit_progress(self, transfer, force=False):
        now = time.time()
        if not force and now - self._progress_at.get(transfer["id"], 0) < PROGRESS_EVERY:
            return
        self._progress_at[transfer["id"]] = now
        if transfer["started"]:
            transfer["speed"] = transfer["done"] / max(now - transfer["started"], 1e-6)
        self.hub.publish("transfer", dict(transfer))

    def _finish_transfer(self, transfer, status, error=None, verified=None):
        transfer["status"] = status
        transfer["error"] = error
        if verified is not None:
            transfer["verified"] = verified
        transfer["ended"] = time.time()
        if transfer["started"]:
            transfer["speed"] = transfer["done"] / max(transfer["ended"] - transfer["started"], 1e-6)
        self.hub.publish("transfer", dict(transfer))

    # ------------------------------------------------------------ sending files
    def send_file(self, target, path, display_name=None, cleanup=False):
        conns = self._targets(target)
        if not os.path.isfile(path):
            raise NodeError("File not found")
        size = os.path.getsize(path)
        if size > MAX_FILE_BYTES:
            raise NodeError("File is too large")
        name = safe_filename(display_name or os.path.basename(path))
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
        sha256 = digest.hexdigest()

        remaining = {"count": len(conns)}
        guard = threading.Lock()

        def done():
            with guard:
                remaining["count"] -= 1
                last = remaining["count"] == 0
            if last and cleanup:
                try:
                    os.remove(path)
                except OSError:
                    pass

        started = []
        for conn in conns:
            transfer = self._new_transfer(conn, "out", name, size, sha256)
            started.append(dict(transfer))
            threading.Thread(target=self._upload, args=(conn, transfer, path, done), daemon=True).start()
        return started

    def _upload(self, conn, transfer, path, done):
        try:
            slot = conn.next_slot()
            transfer["status"], transfer["started"] = "active", time.time()
            self._emit_progress(transfer, force=True)
            conn.send_json(P.file_start(transfer["id"], slot, transfer["name"], transfer["size"], transfer["sha256"]))
            first = True
            with open(path, "rb") as handle:
                while True:
                    block = handle.read(P.CHUNK_SIZE)
                    if not block:
                        break
                    conn.send_chunk(slot, block, first=first)
                    first = False
                    transfer["done"] += len(block)
                    self._emit_progress(transfer)
                    if self.throttle_kbps:
                        time.sleep(len(block) / (self.throttle_kbps * 1024))
            with self.lock:
                if transfer["status"] == "active":
                    transfer["status"] = "verifying"        # waiting for the receiver's checksum answer
            self._emit_progress(transfer, force=True)
        except (OSError, P.ProtocolError) as exc:
            self._finish_transfer(transfer, "failed", error=f"Send failed: {exc}")
        finally:
            done()

    def _receive_file_ack(self, conn, msg):
        with self.lock:
            transfer = self.transfers.get(msg.get("id"))
            if transfer is None or transfer["dir"] != "out":
                return
        if msg.get("ok"):
            self._bump("filesSent")
            self._finish_transfer(transfer, "done", verified=True)
            self._activity("success", f"{conn.name} received {transfer['name']} (checksum verified)")
        else:
            self._finish_transfer(transfer, "failed", error=msg.get("reason") or "Receiver rejected the file", verified=False)

    # ------------------------------------------------------------ receiving files
    def _begin_receive(self, conn, msg):
        try:
            tid = str(msg["id"])[:24]
            slot = int(msg["slot"])
            size = int(msg["size"])
            expected = str(msg["sha256"]).lower()
            name = safe_filename(msg["name"])
        except (KeyError, TypeError, ValueError):
            raise P.ProtocolError("malformed file_start")
        if size < 0 or size > MAX_FILE_BYTES or len(expected) != 64:
            raise P.ProtocolError("invalid file metadata")

        transfer = self._new_transfer(conn, "in", name, size, expected)
        transfer["id"] = tid
        with self.lock:
            self.transfers = {k: v for k, v in self.transfers.items() if v is not transfer}
            self.transfers[tid] = transfer
        transfer["status"], transfer["started"] = "active", time.time()

        state = {"transfer": transfer, "remaining": size, "hash": hashlib.sha256(), "expected": expected,
                 "handle": None, "dest": None, "part": None, "discard": False, "first": True}
        try:
            dest = unique_path(self.downloads_dir, name)
            state["dest"], state["part"] = dest, dest + ".part"
            state["handle"] = open(state["part"], "wb")
        except OSError as exc:
            state["discard"] = True
            transfer["error"] = f"Cannot save file: {exc.strerror or exc}"
        conn.incoming[slot] = state
        self._emit_progress(transfer, force=True)
        if size == 0:
            self._finalize_incoming(conn, slot, state)

    def _receive_chunk(self, conn, body, size):
        slot = P.SLOT.unpack_from(body)[0]
        data = body[P.SLOT.size:]
        state = conn.incoming.get(slot)
        if state is None:
            raise P.ProtocolError("chunk for an unknown transfer")
        if state["first"]:
            state["first"] = False
            self._log_frame("rx", conn, P.KIND_CHUNK, P.HEADER.pack(len(body), P.KIND_CHUNK) + body,
                            {"type": "file_chunk", "slot": slot, "bytes": len(data)})
        if len(data) > state["remaining"]:
            raise P.ProtocolError("more file data than announced")
        state["remaining"] -= len(data)
        transfer = state["transfer"]
        transfer["done"] += len(data)
        if not state["discard"]:
            state["hash"].update(data)
            try:
                state["handle"].write(data)
            except OSError as exc:                              # disk full etc. - keep draining so the stream stays in sync
                state["discard"] = True
                transfer["error"] = f"Cannot save file: {exc.strerror or exc}"
        self._emit_progress(transfer)
        if state["remaining"] == 0:
            self._finalize_incoming(conn, slot, state)

    def _finalize_incoming(self, conn, slot, state):
        conn.incoming.pop(slot, None)
        transfer = state["transfer"]
        if state["handle"]:
            try:
                state["handle"].close()
            except OSError:
                pass
        ok = False
        reason = transfer.get("error")
        if not state["discard"]:
            ok = state["hash"].hexdigest() == state["expected"]
            if ok:
                os.replace(state["part"], state["dest"])
            else:
                reason = "Checksum mismatch - file was corrupted in transit"
                self._remove_quietly(state["part"])
        else:
            self._remove_quietly(state["part"])
        if ok:
            saved = os.path.basename(state["dest"])
            transfer["savedAs"] = saved
            self._bump("filesReceived")
            self.file_info[saved] = {"from": conn.name, "sha256": state["expected"], "receivedAt": time.time()}
            self._finish_transfer(transfer, "done", verified=True)
            self._activity("success", f"Received {saved} from {conn.name}")
            self.hub.publish("file", self._file_entry(saved))
        else:
            self._finish_transfer(transfer, "failed", error=reason, verified=False)
            self._activity("error", f"Could not receive {transfer['name']}: {reason}")
        try:
            conn.send_json(P.file_ack(transfer["id"], ok, state["expected"] if ok else None, reason))
        except (OSError, P.ProtocolError):
            pass

    def _abort_incoming(self, conn, state, reason):
        if state["handle"]:
            try:
                state["handle"].close()
            except OSError:
                pass
        if state["part"]:
            self._remove_quietly(state["part"])
        with self.lock:
            self._finish_transfer(state["transfer"], "failed", error=reason)

    @staticmethod
    def _remove_quietly(path):
        try:
            os.remove(path)
        except OSError:
            pass

    # ------------------------------------------------------------ files on disk
    def _file_entry(self, name):
        path = os.path.join(self.downloads_dir, name)
        info = self.file_info.get(name, {})
        stat = os.stat(path)
        return {"name": name, "size": stat.st_size, "mtime": stat.st_mtime,
                "from": info.get("from"), "sha256": info.get("sha256")}

    def list_files(self):
        if not self.downloads_dir or not os.path.isdir(self.downloads_dir):
            return []
        entries = []
        for name in os.listdir(self.downloads_dir):
            if name.startswith(".") or name.endswith(".part"):
                continue
            if os.path.isfile(os.path.join(self.downloads_dir, name)):
                entries.append(self._file_entry(name))
        return sorted(entries, key=lambda e: e["mtime"], reverse=True)

    def file_path(self, name):
        name = safe_filename(name)
        path = os.path.join(self.downloads_dir or "", name)
        if not self.downloads_dir or not os.path.isfile(path):
            raise NodeError("File not found")
        return path

    # ------------------------------------------------------------ heartbeat
    def _heartbeat_loop(self):
        while not self._stop.wait(HEARTBEAT_EVERY):
            with self.lock:
                conns = list(self.conns.values())
            changed = False
            for conn in conns:
                if time.time() - conn.last_seen > SILENCE_LIMIT:
                    self._drop(conn, "timed out")
                    continue
                try:
                    conn.send_json(P.ping(time.time()))
                    changed = True
                except (OSError, P.ProtocolError):
                    self._drop(conn, "connection lost")
            if changed:
                time.sleep(0.3)
                self.hub.publish("peers", self.peers_payload())
