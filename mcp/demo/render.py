#!/usr/bin/env python3
"""Renders a terminal-style MP4 per client from raw/<client>.screen.json.

Shows the real run: the command, the task, each clify tool call with its
(trimmed) result, and the final answer, revealed over ~20 s. Run on a render
box (needs Pillow, ffmpeg and DejaVu Sans Mono):
    python3 render.py [claude codex mcp-use inspector]   -> out/<client>.mp4
The inspector clip is the real browser recording (raw/inspector/session.webm), sped up.
"""
import json
import os
import subprocess
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1920, 1080, 30
PAD, TOP = 56, 120
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SIZE = 25
BG, BAR = (13, 17, 23), (30, 36, 46)
C = {
    "dim": (125, 133, 144), "text": (230, 237, 243), "cmd": (121, 192, 255),
    "tool": (210, 168, 255), "ok": (126, 231, 135), "warn": (255, 166, 87), "title": (240, 246, 252),
}
URL = "https://bold-cloud-h4u6s.run.mcp-use.com/mcp"

font = ImageFont.truetype(FONT, SIZE)
bold = ImageFont.truetype(BOLD, SIZE)
CW = font.getlength("M")
COLS = int((W - 2 * PAD) / CW)
LH = int(SIZE * 1.45)
ROWS = (H - TOP - 40) // LH


def wrap(s, indent=""):
    out = []
    for para in s.split("\n"):
        out += textwrap.wrap(para, COLS - len(indent), subsequent_indent="", drop_whitespace=False) or [""]
    return [indent + l.rstrip() for l in out]


def build(screen):
    """Returns [(text, color, isBold, holdFrames, typed)] in reveal order."""
    ev = []
    add = lambda text, color, hold=6, b=False, typed=False: ev.append((text, color, b, hold, typed))
    cmd = screen["command"].split("   #")[0]
    for i, l in enumerate(wrap("$ " + cmd)):
        add(l, "cmd", 2, typed=True)
    add("", "dim", 8)
    for l in wrap(open(os.path.join(HERE, "task.txt")).read().strip(), "  "):
        add(l, "dim", 3)
    add("", "dim", 14)
    for c in screen["calls"]:
        for j, l in enumerate(wrap(f"● clify · {c['tool']} {c['args']}")):
            add(l, "tool", 4 if j else 14, b=j == 0)
        res = c["result"]
        color = "warn" if "needsConfirmation" in res else "ok" if '"ok":true' in res else "warn"
        for j, l in enumerate(wrap("└ " + res, "  ")):
            add(l if j == 0 else "  " + l.lstrip(), color, 4)
        add("", "dim", 16)
    for l in wrap(screen["answer"].replace("*", "").replace("`", "")):
        add(l, "text", 5)
    add("", "dim", 2)
    add("✓ done" + (f" · {screen['stats']}" if screen.get("stats") else ""), "ok", 30, b=True)
    return ev


def frame(title, model, lines, cursor):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 72], fill=BAR)
    for i, col in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([28 + i * 34, 26, 48 + i * 34, 46], fill=col)
    d.text((150, 20), f"{title}  →  clify MCP on Manufact", font=bold, fill=C["title"])
    right = f"{model.split(' (')[0]}  ·  {URL.replace('https://', '')}"
    d.text((W - PAD - font.getlength(right), 22), right, font=font, fill=C["dim"])
    view = lines[-ROWS:]
    for i, (text, color, b) in enumerate(view):
        d.text((PAD, TOP + i * LH), text, font=bold if b else font, fill=C[color])
    if cursor and view:
        text, _, b = view[-1]
        x = PAD + (bold if b else font).getlength(text)
        d.rectangle([x + 2, TOP + (len(view) - 1) * LH + 2, x + CW, TOP + len(view) * LH - 6], fill=C["cmd"])
    return im.tobytes()


def render(name):
    screen = json.load(open(os.path.join(HERE, "raw", f"{name}.screen.json")))
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    out = os.path.join(HERE, "out", f"{name}.mp4")
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out],
        stdin=subprocess.PIPE,
    )
    shown = []
    n = 0

    def emit(buf, count):
        nonlocal n
        for _ in range(count):
            ff.stdin.write(buf)
        n += count

    emit(frame(screen["title"], screen["model"], shown, True), FPS)  # 1 s empty prompt
    for text, color, b, hold, typed in build(screen):
        if typed:  # type the command ~4 chars per frame
            for k in range(0, len(text) + 1, 4):
                emit(frame(screen["title"], screen["model"], shown + [(text[:k], color, b)], True), 1)
        shown.append((text, color, b))
        emit(frame(screen["title"], screen["model"], shown, False), hold)
    emit(frame(screen["title"], screen["model"], shown, False), max(FPS * 3, FPS * 15 - n))  # hold the answer; clips run ≥15 s
    ff.stdin.close()
    ff.wait()
    print(f"{name}: {out} ({n / FPS:.1f} s)")


def render_inspector(target=15.0):
    """The Inspector clip is the real headless-browser recording, sped up to ~15 s."""
    src = os.path.join(HERE, "raw", "inspector", "session.webm")
    out = os.path.join(HERE, "out", "inspector.mp4")
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).decode().strip() or 0)
    if not dur:  # webm from a closed context may lack a duration header
        dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", src]).decode().strip()) / 25
    k = target / dur
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", f"setpts={k:.4f}*PTS,fps={FPS},scale={W}:{H}:flags=lanczos",
         "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out],
        check=True,
    )
    print(f"inspector: {out} ({dur:.1f} s recording at {1 / k:.1f}x)")


if __name__ == "__main__":
    for name in sys.argv[1:] or ["claude", "codex", "mcp-use", "inspector"]:
        render_inspector() if name == "inspector" else render(name)
