// RFC 6238 one-time codes from the 2FA secret the user stored in the vault
// (the same secret an authenticator app or 1Password holds).
import crypto from "node:crypto";

function base32(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("2FA secret is not valid base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// Accepts a bare base32 secret or an otpauth://totp/...?secret=...&digits=&period=&algorithm= URI.
export function totp(secretOrUri: string, now = Date.now()): string {
  let secret = secretOrUri;
  let digits = 6;
  let period = 30;
  let algo = "sha1";
  if (secretOrUri.startsWith("otpauth://")) {
    const u = new URL(secretOrUri);
    secret = u.searchParams.get("secret") ?? "";
    digits = Number(u.searchParams.get("digits") ?? 6);
    period = Number(u.searchParams.get("period") ?? 30);
    algo = (u.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const h = crypto.createHmac(algo, base32(secret)).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}
