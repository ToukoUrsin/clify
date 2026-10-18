# Summarize a test/sites/run.sh output dir as a markdown table.
import json, os, sys, glob
out = sys.argv[1]
rows = []
for f in sorted(glob.glob(os.path.join(out, "*.json"))):
    try:
        d = json.load(open(f))
    except Exception:
        d = {"ok": False, "blockers": ["no JSON output (crash/timeout)"], "commands": [], "verified": 0}
    wall = {}
    try:
        wall = json.load(open(f[:-5] + ".wall"))
    except Exception:
        pass
    gen = len(d.get("commands", [])) + len(d.get("dropped", []))
    notes = []
    if d.get("error"): notes.append(d["error"][:90])
    for b in d.get("blockers", [])[:2]: notes.append(str(b)[:90])
    drops = d.get("dropped", [])
    if drops: notes.append(f"dropped {len(drops)}: " + "; ".join(f"{x['name']} ({(x.get('reason') or '')[:50]})" for x in drops[:2]))
    rows.append((d.get("url") or wall.get("url") or os.path.basename(f), d.get("site", "?"), gen, d.get("verified", 0), d.get("writes", 0), wall.get("wall", d.get("seconds", 0)), " · ".join(notes)))
print("| site | name | generated | verified | writes | time | notes |")
print("|---|---|---|---|---|---|---|")
for r in rows:
    print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]//60}m{r[5]%60:02d}s | {r[6]} |")
ok3 = sum(1 for r in rows if r[3] >= 3)
print(f"\n{len(rows)} sites; {ok3} ({round(100*ok3/max(1,len(rows)))}%) with ≥3 verified commands; {sum(r[3] for r in rows)} verified commands total")
