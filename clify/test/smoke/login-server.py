#!/usr/bin/env python3
import http.server
import json
import sys
import urllib.parse

PORT = int(sys.argv[1])
LOG = sys.argv[2]

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/login":
            body = b'''<!doctype html><form method="post" action="/login">
              <label>Email <input type="email" name="email" autocomplete="username"></label>
              <label>Password <input type="password" name="password" autocomplete="current-password"></label>
              <button type="submit">Sign in</button>
            </form>'''
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/dashboard":
            ok = self.headers.get("Cookie") == "sid=fixture-session"
            body = b"<h1>Account dashboard</h1>" if ok else b"<h1>Not signed in</h1>"
            self.send_response(200 if ok else 401)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/login":
            self.send_error(404)
            return
        size = int(self.headers.get("Content-Length", "0"))
        form = urllib.parse.parse_qs(self.rfile.read(size).decode())
        # Record only field names, never credentials.
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"path": self.path, "fields": sorted(form)}) + "\n")
        self.send_response(302)
        self.send_header("Set-Cookie", "sid=fixture-session; Path=/")
        self.send_header("Location", "/dashboard")
        self.end_headers()

if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
