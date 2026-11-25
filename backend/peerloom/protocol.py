"""
Peerloom wire protocol, version 2.

Every frame on a TCP connection looks like this::

    +----------------+-----------+----------------------+
    | length  (4 B)  | kind (1B) |  body  (length B)    |
    +----------------+-----------+----------------------+
       big-endian       0 or 1

kind 0  JSON frame   - body is a UTF-8 JSON object with a "type" field
kind 1  chunk frame  - body is a 4-byte transfer slot followed by raw file bytes

Because file data travels in small chunk frames (not as one long raw blob), text
messages, pings and acknowledgements can be interleaved with a running upload,
and several files can be in flight over the same connection at once.
"""
import json
import struct
import time

PROTOCOL_VERSION = 2

HEADER = struct.Struct("!IB")          # body length, frame kind
HEADER_SIZE = HEADER.size              # 5 bytes
SLOT = struct.Struct("!I")             # transfer slot at the start of a chunk body

KIND_JSON = 0
KIND_CHUNK = 1

MAX_JSON_BYTES = 1024 * 1024           # a JSON frame is never larger than 1 MiB
CHUNK_SIZE = 48 * 1024                 # file bytes per chunk frame
MAX_FRAME_BYTES = CHUNK_SIZE + SLOT.size + 1024

# JSON message types
HELLO, HELLO_ACK = "hello", "hello_ack"
TEXT, ACK = "text", "ack"
PING, PONG = "ping", "pong"
PEERS = "peers"
FILE_START, FILE_ACK = "file_start", "file_ack"
ERROR, BYE = "error", "bye"


class ProtocolError(Exception):
    """The other side sent something that breaks the protocol."""


class ConnectionClosed(ConnectionError):
    """The other side closed the TCP connection."""


# ---------------------------------------------------------------- reading
def recv_exact(sock, count):
    """Read exactly `count` bytes. recv() may return fewer, so keep asking."""
    parts, remaining = [], count
    while remaining > 0:
        piece = sock.recv(min(remaining, 262144))
        if not piece:
            raise ConnectionClosed("peer closed the connection")
        parts.append(piece)
        remaining -= len(piece)
    return b"".join(parts)


def read_frame(sock):
    """Return (kind, body, total_bytes_on_wire)."""
    header = recv_exact(sock, HEADER_SIZE)
    length, kind = HEADER.unpack(header)
    if kind == KIND_JSON:
        if length == 0 or length > MAX_JSON_BYTES:
            raise ProtocolError(f"invalid JSON frame length {length}")
    elif kind == KIND_CHUNK:
        if length <= SLOT.size or length > MAX_FRAME_BYTES:
            raise ProtocolError(f"invalid chunk frame length {length}")
    else:
        raise ProtocolError(f"unknown frame kind {kind}")
    body = recv_exact(sock, length)
    return kind, body, HEADER_SIZE + length


def parse_json(body):
    try:
        message = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ProtocolError(f"frame is not valid JSON: {exc}")
    if not isinstance(message, dict) or "type" not in message:
        raise ProtocolError("JSON frame must be an object with a 'type' field")
    return message


# ---------------------------------------------------------------- writing
def encode_json(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_JSON_BYTES:
        raise ProtocolError("message too large")
    return HEADER.pack(len(body), KIND_JSON) + body


def encode_chunk(slot, data):
    return HEADER.pack(SLOT.size + len(data), KIND_CHUNK) + SLOT.pack(slot) + data


def hex_preview(data, limit=40):
    shown = data[:limit]
    text = " ".join(f"{b:02x}" for b in shown)
    return text + (" …" if len(data) > limit else "")


# ---------------------------------------------------------------- builders
def hello(peer_id, name, port):
    return {"type": HELLO, "proto": PROTOCOL_VERSION, "id": peer_id, "name": name, "port": port}


def hello_ack(peer_id, name, port):
    return {"type": HELLO_ACK, "proto": PROTOCOL_VERSION, "id": peer_id, "name": name, "port": port}


def text(message_id, body, scope="direct"):
    return {"type": TEXT, "id": message_id, "text": body, "scope": scope, "ts": time.time()}


def ack(message_id):
    return {"type": ACK, "id": message_id}


def ping(sent_at):
    return {"type": PING, "t": sent_at}


def pong(sent_at):
    return {"type": PONG, "t": sent_at}


def peers(entries):
    return {"type": PEERS, "peers": entries}


def file_start(transfer_id, slot, name, size, sha256):
    return {"type": FILE_START, "id": transfer_id, "slot": slot, "name": name, "size": size, "sha256": sha256}


def file_ack(transfer_id, ok, sha256=None, reason=None):
    return {"type": FILE_ACK, "id": transfer_id, "ok": ok, "sha256": sha256, "reason": reason}


def error(code, message):
    return {"type": ERROR, "code": code, "message": message}


def bye(reason="closing"):
    return {"type": BYE, "reason": reason}
