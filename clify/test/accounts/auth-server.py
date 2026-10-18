#!/usr/bin/env python3
"""Local test site for clify account flows: password login, TOTP second step,
an SPA that keeps a short-lived JWT + refresh token in localStorage, a
/api/me endpoint that needs the bearer token, and a refresh endpoint.
Usage: auth-server.py PORT EMAIL PASSWORD TOTP_SECRET [ACCESS_TTL_SECONDS]"""
import base64, hashlib, hmac, http.server, json, secrets, struct, sys, time, urllib.parse

PORT, EMAIL, PASSWORD, SECRET = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
TTL = int(sys.argv[5]) if len(sys.argv) > 5 else 30
KEY = secrets.token_bytes(32)
pending, sessions, refresh_tokens = set(), set(), {}
log = []

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def jwt(sub, ttl):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps({"sub": sub, "exp": int(time.time()) + ttl}).encode())
    s = b64(hmac.new(KEY, f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"

def jwt_ok(tok):
    try:
        h, p, s = tok.split(".")
        if not hmac.compare_digest(s, b64(hmac.new(KEY, f"{h}.{p}".encode(), hashlib.sha256).digest())): return None
        body = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        return body if body["exp"] > time.time() else None
    except Exception:
        return None

def totp(secret, t=None):
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    c = struct.pack(">Q", int((t or time.time()) // 30))
    h = hmac.new(key, c, hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)

APP = """<!doctype html><title>Test app</title><h1>Dashboard</h1><p id=who>loading…</p><a href="/logout">Sign out</a>
<script>
async function boot(){
  let auth = JSON.parse(localStorage.getItem('auth')||'null');
  if(!auth){ const r = await fetch('/api/token',{method:'POST'}); if(!r.ok){location='/login';return;} auth = await r.json(); }
  // the app renews its token on start, like many SPAs do
  const rr = await fetch('/api/token/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:auth.refreshToken})});
  if(rr.ok){ const j = await rr.json(); auth = {accessToken:j.access_token, refreshToken:j.refresh_token}; }
  localStorage.setItem('auth', JSON.stringify(auth));
  const me = await fetch('/api/me',{headers:{authorization:'Bearer '+auth.accessToken}});
  document.getElementById('who').textContent = me.ok ? 'Signed in as '+(await me.json()).email : 'error';
}
boot();
</script>"""

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def send(self, code, body, ctype="text/html", headers=()):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        for k, v in headers: self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name: return v
        return None

    def form(self):
        n = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(n).decode()
        return raw, urllib.parse.parse_qs(raw)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/": return self.send(200, '<h1>Test site</h1><a href="/login">Log in</a> <a href="/terms">Terms</a>')
        if p == "/login":
            return self.send(200, '<h1>Sign in</h1><form method=post action=/login><label>Email <input type=email name=email autocomplete=username></label>'
                                  '<label>Password <input type=password name=password autocomplete=current-password></label><button>Sign in</button></form>')
        if p == "/2fa":
            if self.cookie("pre") not in pending: return self.send(302, "", headers=[("Location", "/login")])
            return self.send(200, '<h1>Two-factor authentication</h1><form method=post action=/2fa><label>Authentication code '
                                  '<input name=otp inputmode=numeric autocomplete=one-time-code></label><button>Verify</button></form>')
        if p == "/app":
            if self.cookie("sid") not in sessions: return self.send(302, "", headers=[("Location", "/login")])
            return self.send(200, APP)
        if p == "/api/me":
            auth = self.headers.get("Authorization", "")
            body = jwt_ok(auth[7:]) if auth.startswith("Bearer ") else None
            log.append({"path": p, "ok": bool(body)})
            if not body: return self.send(401, '{"error":"token expired or missing"}', "application/json")
            return self.send(200, json.dumps({"email": body["sub"], "name": "clify agent", "plan": "free"}), "application/json")
        if p == "/terms": return self.send(200, "<h1>Terms of service</h1><p>Automated clients and agents are welcome.</p>" * 20)
        if p == "/logout": return self.send(302, "", headers=[("Location", "/"), ("Set-Cookie", "sid=; Path=/; Max-Age=0")])
        self.send(404, "not found")

    def do_POST(self):
        p = self.path.split("?")[0]
        raw, f = self.form()
        if p == "/login":
            if f.get("email", [""])[0] == EMAIL and f.get("password", [""])[0] == PASSWORD:
                t = secrets.token_hex(16); pending.add(t)
                return self.send(302, "", headers=[("Location", "/2fa"), ("Set-Cookie", f"pre={t}; Path=/; HttpOnly")])
            return self.send(401, '<p>Invalid email or password</p><a href="/login">Try again</a>')
        if p == "/2fa":
            code = f.get("otp", [""])[0].strip()
            if self.cookie("pre") in pending and code in (totp(SECRET), totp(SECRET, time.time() - 30)):
                pending.discard(self.cookie("pre"))
                s = secrets.token_hex(16); sessions.add(s)
                return self.send(302, "", headers=[("Location", "/app"), ("Set-Cookie", f"sid={s}; Path=/; HttpOnly")])
            return self.send(401, '<p>Invalid code</p><a href="/2fa">Try again</a>')
        if p == "/api/token":
            if self.cookie("sid") not in sessions: return self.send(401, "{}", "application/json")
            rt = secrets.token_urlsafe(24); refresh_tokens[rt] = EMAIL
            return self.send(200, json.dumps({"accessToken": jwt(EMAIL, TTL), "refreshToken": rt}), "application/json")
        if p == "/api/token/refresh":
            try: rt = json.loads(raw).get("refresh_token")
            except Exception: rt = None
            sub = refresh_tokens.pop(rt, None)
            log.append({"path": p, "ok": bool(sub)})
            if not sub: return self.send(401, '{"error":"bad refresh token"}', "application/json")
            nrt = secrets.token_urlsafe(24); refresh_tokens[nrt] = sub
            return self.send(200, json.dumps({"access_token": jwt(sub, TTL), "refresh_token": nrt, "expires_in": TTL}), "application/json")
        self.send(404, "not found")

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
