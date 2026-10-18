# Static mock server for the clify smoke test. Serves files from ./static and
# appends one line per request (method, path, cookie header) to the log file.
# POST/PUT/DELETE are only logged and answered 201; nothing is stored.
import http.server, json, os, sys

port, logfile = int(sys.argv[1]), sys.argv[2]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=root, **k)
    def _log(self):
        with open(logfile, "a") as f:
            f.write(json.dumps({"method": self.command, "host": self.headers.get("Host"), "path": self.path, "cookie": self.headers.get("Cookie")}) + "\n")
    def do_GET(self):
        self._log()
        self.path = self.path.split("?")[0]
        super().do_GET()
    def _write(self):
        self._log()
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"created":true}')
    do_POST = do_PUT = do_DELETE = _write
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
