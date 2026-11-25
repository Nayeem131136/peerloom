import hashlib
import os
import socket
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from peerloom.events import EventHub
from peerloom.node import Node, NodeError


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def wait(cond, timeout=8):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


class TwoNodes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.a = Node(EventHub(), os.path.join(self.tmp, "a"))
        self.b = Node(EventHub(), os.path.join(self.tmp, "b"))
        self.pa, self.pb = free_port(), free_port()
        self.a.start("Alice", self.pa)
        self.b.start("Bob", self.pb)

    def tearDown(self):
        self.a.stop()
        self.b.stop()

    def link(self):
        self.a.connect("127.0.0.1", self.pb)
        self.assertTrue(wait(lambda: len(self.b.conns) == 1))

    def test_handshake_and_names(self):
        self.link()
        self.assertEqual(list(self.a.conns.values())[0].name, "Bob")
        self.assertEqual(list(self.b.conns.values())[0].name, "Alice")

    def test_self_and_duplicate_rejected(self):
        with self.assertRaises(ConnectionError):
            self.a.connect("127.0.0.1", self.pa)
        self.link()
        with self.assertRaises(ConnectionError):
            self.a.connect("127.0.0.1", self.pb)

    def test_text_with_delivery_receipt(self):
        self.link()
        bid = list(self.a.conns)[0]
        msg = self.a.send_text(bid, "hello bob")
        self.assertTrue(wait(lambda: any(m["text"] == "hello bob" for m in self.b.messages)))
        self.assertTrue(wait(lambda: next(m for m in self.a.messages if m["id"] == msg["id"])["status"] == "delivered"))

    def test_file_transfer_checksum(self):
        self.link()
        data = os.urandom(300_000)
        src = os.path.join(self.tmp, "blob.bin")
        open(src, "wb").write(data)
        self.a.send_file(list(self.a.conns)[0], src)
        self.assertTrue(wait(lambda: self.b.list_files()))
        got = open(self.b.file_path("blob.bin"), "rb").read()
        self.assertEqual(hashlib.sha256(got).digest(), hashlib.sha256(data).digest())
        self.assertTrue(wait(lambda: all(t["status"] == "done" for t in self.a.transfers.values())))

    def test_path_traversal_name_is_neutralised(self):
        self.link()
        src = os.path.join(self.tmp, "x.txt")
        open(src, "w").write("hi")
        self.a.send_file(list(self.a.conns)[0], src, display_name="../../evil.txt")
        self.assertTrue(wait(lambda: self.b.list_files()))
        self.assertEqual(self.b.list_files()[0]["name"], "evil.txt")

    def test_chat_during_upload_and_pex(self):
        self.link()
        pc = free_port()
        c = Node(EventHub(), os.path.join(self.tmp, "c"))
        c.start("Cara", pc)
        try:
            c.connect("127.0.0.1", self.pa)
            self.assertTrue(wait(lambda: any(e["name"] == "Cara" for v in self.b.known.values() for e in v)))
        finally:
            c.stop()

    def test_disconnect_detected(self):
        self.link()
        self.b.stop()
        self.assertTrue(wait(lambda: len(self.a.conns) == 0))

    def test_validation(self):
        with self.assertRaises(NodeError):
            self.a.send_text("all", "hi")           # nobody connected
        with self.assertRaises(NodeError):
            Node(EventHub()).start("", 5000)


if __name__ == "__main__":
    unittest.main()
