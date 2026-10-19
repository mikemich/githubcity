#!/usr/bin/env python3
"""Serves githubcity locally with caching off, so edits show up on reload.

Usage: python3 serve.py [port]   (default 4173)
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    print(f"githubcity on http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
