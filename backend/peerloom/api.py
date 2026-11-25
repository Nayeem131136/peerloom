"""Local control API for the Peerloom dashboard: JSON over HTTP plus a Server-Sent Events stream."""
import json
import os
import queue
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

from .node import MAX_FILE_BYTES, NodeError

ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


def origin_allowed(origin):
    if not origin:
        return True                                    # curl, tests, same-origin requests
    host = urlparse(origin).hostname or ""
    return host in ALLOWED_HOSTS


def make_server(node, hub, host, port):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "Peerloom"

        def log_message(self, *args):
            pass

        # ---------- helpers
        def _cors(self):
            origin = self.headers.get("Origin")
            if origin and origin_allowed(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _json(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _error(self, status, message):
            self._json(status, {"error": message})

        def _guard(self):
            if not origin_allowed(self.headers.get("Origin")):
                self._error(403, "Origin not allowed")
                return False
            return True

        def _read_json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > 1_000_000:
                raise NodeError("Request too large")
            raw = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(raw or b"{}")
            except ValueError:
                raise NodeError("Invalid JSON")
            if not isinstance(data, dict):
                raise NodeError("Expected a JSON object")
            return data

        def do_OPTIONS(self):
            if not self._guard():
                return
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        # ---------- GET
        def do_GET(self):
            if not self._guard():
                return
            url = urlparse(self.path)
            path = url.path
            if path == "/":
                return self._json(200, {"service": "peerloom", "message": "Peerloom API is running. Open the dashboard at http://localhost:3000"})
            if path == "/api/health":
                return self._json(200, {"ok": True, "running": node.running})
            if path == "/api/state":
                return self._json(200, node.snapshot())
            if path == "/api/files":
                return self._json(200, node.list_files())
            if path == "/api/events":
                return self._stream()
            if path.startswith("/api/files/"):
                return self._download(unquote(path[len("/api/files/"):]))
            self._error(404, "Not found")

        def _stream(self):
            channel = hub.subscribe()
            try:
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                self._event("snapshot", node.snapshot())
                last_stats = 0
                while True:
                    try:
                        kind, data = channel.get(timeout=1.0)
                        self._event(kind, data)
                    except queue.Empty:
                        pass
                    if time.time() - last_stats >= 1.0:
                        last_stats = time.time()
                        self._event("stats", node.stats())
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                hub.unsubscribe(channel)
                self.close_connection = True

        def _event(self, kind, data):
            self.wfile.write(f"event: {kind}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        def _download(self, name):
            try:
                path = node.file_path(name)
            except NodeError as exc:
                return self._error(404, str(exc))
            size = os.path.getsize(path)
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(os.path.basename(path))}")
            self.end_headers()
            with open(path, "rb") as handle:
                while True:
                    block = handle.read(256 * 1024)
                    if not block:
                        break
                    self.wfile.write(block)

        # ---------- POST
        def do_POST(self):
            if not self._guard():
                return
            url = urlparse(self.path)
            try:
                if url.path == "/api/files":
                    return self._upload(parse_qs(url.query))
                data = self._read_json()
                if url.path == "/api/start":
                    port = data.get("port")
                    node.start(data.get("name"), int(port) if str(port).lstrip("-").isdigit() else -1)
                    return self._json(200, node.me())
                if url.path == "/api/stop":
                    node.stop()
                    return self._json(200, node.me())
                if url.path == "/api/connect":
                    port = data.get("port")
                    peer = node.connect(data.get("host"), int(port) if str(port).isdigit() else -1)
                    return self._json(200, peer)
                if url.path == "/api/disconnect":
                    node.disconnect(data.get("id"))
                    return self._json(200, {"ok": True})
                if url.path == "/api/messages":
                    return self._json(200, node.send_text(data.get("to", "all"), data.get("text")))
                self._error(404, "Not found")
            except NodeError as exc:
                self._error(400, str(exc))
            except ConnectionError as exc:
                self._error(502, str(exc))

        def _upload(self, query):
            target = (query.get("to") or ["all"])[0]
            name = (query.get("name") or ["file"])[0]
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                raise NodeError("Empty upload")
            if length > MAX_FILE_BYTES:
                raise NodeError("File is too large")
            node._targets(target)                       # fail fast before streaming gigabytes
            fd, tmp = tempfile.mkstemp(prefix="peerloom-", suffix=".upload")
            try:
                with os.fdopen(fd, "wb") as out:
                    left = length
                    while left > 0:
                        block = self.rfile.read(min(256 * 1024, left))
                        if not block:
                            raise NodeError("Upload was interrupted")
                        out.write(block)
                        left -= len(block)
                result = node.send_file(target, tmp, display_name=name, cleanup=True)
            except Exception:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
            self._json(200, {"transfers": result})

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = os.name != "nt"

    return Server((host, port), Handler)
