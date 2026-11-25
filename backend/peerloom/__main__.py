import argparse
import os

from . import __version__
from .api import make_server
from .events import EventHub
from .node import Node


def main():
    parser = argparse.ArgumentParser(prog="peerloom", description="Peerloom local node + dashboard API")
    parser.add_argument("--api-port", type=int, default=8801, help="dashboard API port (default 8801)")
    parser.add_argument("--name", help="auto-start the peer with this name")
    parser.add_argument("--port", type=int, help="auto-start the peer on this TCP port")
    parser.add_argument("--downloads", default=os.environ.get("PEERLOOM_DOWNLOADS", "downloads"))
    parser.add_argument("--throttle", type=int, default=0, help="limit upload speed in KB/s (demo/testing)")
    args = parser.parse_args()

    hub = EventHub()
    node = Node(hub, downloads_root=args.downloads, throttle_kbps=args.throttle)
    server = make_server(node, hub, "127.0.0.1", args.api_port)
    if args.name and args.port:
        node.start(args.name, args.port)
    print(f"Peerloom {__version__} - API on http://127.0.0.1:{args.api_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        node.stop()


if __name__ == "__main__":
    main()
