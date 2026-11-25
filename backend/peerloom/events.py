"""A tiny thread-safe publish/subscribe hub that feeds the Server-Sent-Events stream."""
import queue
import threading


class EventHub:
    def __init__(self):
        self._subscribers = set()
        self._lock = threading.Lock()

    def subscribe(self):
        q = queue.Queue(maxsize=2000)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            self._subscribers.discard(q)

    def publish(self, kind, data):
        with self._lock:
            targets = list(self._subscribers)
        for q in targets:
            try:
                q.put_nowait((kind, data))
            except queue.Full:                 # a stuck browser tab must never block the network threads
                pass
