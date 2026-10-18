# Builds the proofs from Blaxel run dirs (test/blaxel/run.mjs):
#   python3 test/blaxel/report.py OUT_DIR [OUT_DIR...]
# writes proofs/sites-blaxel.md, proofs/sites-blaxel/<site>.{spec,run}.json,
# proofs/wall.json (with the earlier 44-site run as "box"), and copies each spec
# with >=3 commands verified on Blaxel to specs/<site>.json (built-ins).
import glob, json, os, re, sys

CLIFY = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PROOFS = os.path.join(CLIFY, "proofs")
SPECS = os.path.join(CLIFY, "specs")

# Categories for the earlier 44-site run (proofs/sites.md).
EARLIER = {
    "crates": "dev", "dev-to": "dev", "docs-rs": "dev", "pypi": "dev", "rubygems": "dev", "packagist": "dev", "pkg-go": "dev", "hub-docker": "dev",
    "formulae-brew": "dev", "nuget": "dev", "jsdelivr": "dev", "huggingface": "dev", "docs": "dev",
    "developer-mozilla": "dev", "docs-python": "dev", "dev": "dev",
    "catalog-data": "gov-us", "federalregister": "gov-us", "clinicaltrials": "gov-us", "usaspending": "gov-us",
    "data-gov": "gov-eu", "legislation": "gov-eu", "data-europa": "gov-eu", "ted-europa": "gov-eu",
    "hankintailmoitukset": "gov-nordic", "weather": "maps-weather", "earthquake-usgs": "maps-weather",
    "openstreetmap": "maps-weather", "arxiv": "science", "pubmed-ncbi": "science", "rcsb": "science",
    "inaturalist": "science", "metmuseum": "culture", "artic": "culture", "musicbrainz": "culture",
    "openverse": "culture", "images-nasa": "culture", "gutenberg": "culture", "archive": "culture",
    "finna": "culture", "news-ycombinator": "news", "theguardian": "news", "tvmaze": "sports-ent",
    "lichess": "sports-ent", "ycombinator": "jobs-market", "remoteok": "jobs-market",
}


def example(site, spec):
    for c in spec.get("commands", []):
        if c.get("mutates") or not c.get("verified", True):
            continue
        args = " ".join(f"--{k} {json.dumps(v) if re.search(r'[^A-Za-z0-9_.:/-]', str(v)) else v}" for k, v in (c.get("example") or {}).items())
        return f"clify {site} {c['name']}" + (f" {args}" if args else "")
    return None


def origin(url):
    m = re.match(r"(https?://[^/]+)", url)
    return m.group(1) if m else url


def load_runs(dirs):
    runs = {}
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, "*.json"))):
            r = json.load(open(f))
            if "url" not in r:
                continue
            r["_home"] = os.path.join(d, "home")
            prev = runs.get(r["url"])
            # a re-run replaces an earlier attempt only if it verified more
            if not prev or (r.get("check") or {}).get("verified", -1) >= (prev.get("check") or {}).get("verified", -1):
                runs[r["url"]] = r
    return list(runs.values())


def main(dirs):
    runs = load_runs(dirs)
    os.makedirs(os.path.join(PROOFS, "sites-blaxel"), exist_ok=True)
    # names already taken by built-ins that did not come from a Blaxel run (re-running this script is idempotent)
    from_blaxel = {(r.get("add") or {}).get("site") for r in runs}
    builtin_before = {f[:-5] for f in os.listdir(SPECS) if f.endswith(".json")} - from_blaxel
    rows, wall, added = [], [], []
    for r in sorted(runs, key=lambda r: (r.get("category", ""), r["url"])):
        add = r.get("add") or {}
        site = add.get("site") or "?"
        chk = r.get("check") or {}
        gen = len(add.get("commands", [])) + len(add.get("dropped", []))
        ver = chk.get("verified", 0)
        notes = []
        if r.get("error"): notes.append(r["error"][:100])
        if add.get("error"): notes.append(str(add["error"])[:100])
        for b in (add.get("blockers") or [])[:2]: notes.append(str(b)[:80])
        if add.get("dropped"): notes.append(f"dropped {len(add['dropped'])} at add")
        if chk.get("failed"): notes.append("failed on Blaxel: " + "; ".join(f"{x['name']} ({x['reason'][:50]})" for x in chk["failed"][:2]))
        if chk.get("error"): notes.append("check error: " + chk["error"][:80])
        if not r.get("deleted"): notes.append("sandbox NOT deleted")
        spec_file = os.path.join(r["_home"], "sites", site, "spec.json")
        spec = json.load(open(spec_file)) if site != "?" and os.path.exists(spec_file) else None
        if spec:
            # Commands that failed on Blaxel move to dropped, so the shipped spec only lists what passed there.
            failed = {x["name"]: x["reason"] for x in chk.get("failed", [])}
            keep = [c for c in spec["commands"] if c["name"] not in failed]
            spec["dropped"] = spec.get("dropped", []) + [dict(c, verified=False, verifyNote=f"failed on Blaxel: {failed[c['name']]}") for c in spec["commands"] if c["name"] in failed]
            spec["commands"] = keep
            json.dump(spec, open(os.path.join(PROOFS, "sites-blaxel", f"{site}.spec.json"), "w"), indent=1)
            json.dump({k: v for k, v in r.items() if not k.startswith("_")}, open(os.path.join(PROOFS, "sites-blaxel", f"{site}.run.json"), "w"), indent=1)
            if ver >= 3:
                if site in builtin_before and site not in added:
                    notes.append(f"name '{site}' already built in: not copied")
                else:
                    json.dump(spec, open(os.path.join(SPECS, f"{site}.json"), "w"), indent=1)
                    added.append(site)
                wall.append({"site": site, "origin": origin(r["url"]), "category": r.get("category", ""), "commands": len(spec["commands"]),
                             "verified": ver, "verifiedOn": "blaxel", "sandbox": r["sandbox"], "example": example(site, spec)})
        rows.append((r["url"], r.get("category", ""), site, gen, add.get("verified", 0), ver, chk.get("reads", 0), r.get("seconds", 0), r["sandbox"], " · ".join(notes)))

    # earlier 44-site run (box browser, box verification)
    earlier = []
    for f in sorted(glob.glob(os.path.join(PROOFS, "sites", "*.add-report.json"))):
        rep = json.load(open(f))
        site = rep["site"]
        sp = os.path.join(PROOFS, "sites", f"{site}.spec.json")
        spec = json.load(open(sp)) if os.path.exists(sp) else {"commands": []}
        earlier.append(rep)
        if rep.get("verified", 0) >= 3:
            wall.append({"site": site, "origin": origin(rep["url"]), "category": EARLIER.get(site, ""), "commands": len(spec.get("commands", [])),
                         "verified": rep["verified"], "verifiedOn": "box", "example": example(site, spec)})

    n_new = len(rows)
    ok_new = sum(1 for r in rows if r[5] >= 3)
    ver_new = sum(r[5] for r in rows)
    ok_old = sum(1 for e in earlier if e.get("verified", 0) >= 3)
    ver_old = sum(e.get("verified", 0) for e in earlier)
    secs = sorted(r[7] for r in rows if r[5] >= 3)
    med = secs[len(secs) // 2] if secs else 0

    md = [f"# `clify add` on {n_new} more sites, browsers and verification on Blaxel (2026-10-18)", "",
          "Run: `node test/blaxel/run.mjs` over [sites.txt](../test/blaxel/sites.txt) (86 sites) and [sites-wave2.txt](../test/blaxel/sites-wave2.txt) (30) on a Linux build machine, at most 6 sites (sandboxes) at a time, `clify add` under `nice -n 10`, model `claude-opus-5-5`. For every site:",
          "",
          "1. A fresh Blaxel sandbox (`blaxel/playwright-chromium`, 4 GB, us-pdx-1) starts stock headless Chrome (no stealth flags, default user agent) and `test/blaxel/cdp-proxy.mjs`, which serves its DevTools endpoint on port 9300. clify reaches it through the sandbox API's authenticated port route (`wss://<sandbox>/port/9300/`). The first sites of the run used a private, token-protected preview URL instead, until the workspace hit its 20-preview quota.",
          "2. `clify add <url> --account none` runs on the box (the model calls go to Claude Opus 5.5 from there) with `CLIFY_CDP_URL` pointing at that sandbox: every page the explorer opens loads in the sandbox's Chrome, and the recorder and write guard work over CDP.",
          "3. The generated spec is copied into the same sandbox with clify (`test/blaxel/bundle.sh`) and `clify check <site>` runs there: every read command's example, live, with no model calls. **verified on Blaxel** counts the read commands that returned real data in that run; commands that failed there are moved to `dropped` in the shipped spec.",
          "4. The sandbox is deleted.",
          "",
          "Start pages were checked against robots.txt first (`test/sites/robots-check.ts`); 12 of 128 candidates were skipped because robots.txt disallows them ([test/blaxel/candidates.txt](../test/blaxel/candidates.txt)). No accounts were created, no writes were sent, and CAPTCHAs/bot checks were reported and left alone. Per-site specs and run records: [sites-blaxel/](sites-blaxel/).",
          "",
          "Sites whose `clify add` hit one of two clify bugs this run surfaced (a malformed form body aborted saving the recording; `clify check` crashed on a command whose output was undefined; both fixed in this commit), or whose sandbox Chrome crashed, were run once more; the table keeps the better attempt. svt.se's Blaxel check was re-run in a fresh sandbox after the `check` fix (`test/blaxel/recheck.mjs`).",
          "",
          "A few specs include public keys that the sites' own web pages send to every visitor (search-only Algolia/Typesense keys, the api.data.gov keys embedded in fec.gov, eia.gov and nps.gov pages). They are not account credentials.",
          "",
          "| site | category | name | generated | verified at add | verified on Blaxel | time | sandbox | notes |",
          "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]}/{r[6]} | {r[7]//60}m{r[7]%60:02d}s | `{r[8]}` | {r[9]} |")
    md += ["",
           f"**This run:** {n_new} sites; {ok_new} ({round(100*ok_new/max(1,n_new))}%) with ≥3 commands verified on Blaxel; {ver_new} commands verified on Blaxel; median {med//60}m{med%60:02d}s per successful site (sandbox start, exploration, synthesis, repair, Blaxel check).",
           "",
           f"Misses ({n_new - ok_new}): {sum(1 for r in rows if r[5] < 3 and re.search(r'captcha|bot-check', r[9]))} behind bot checks or CAPTCHAs (reported, never bypassed), the rest are crashes of the sandbox browser, sites that answered nothing usable, or endpoints that refused the Blaxel sandbox's network (openlibrary.org: connection refused from the sandbox) — see notes.",
           "",
           f"**Combined with the earlier run** ([sites.md](sites.md), 44 sites, browser and checks on the box): {n_new + len(earlier)} sites, **{ok_new + ok_old} with ≥3 verified commands**, {ver_new + ver_old} verified commands. The wall for the film is [wall.json](wall.json) ({len(wall)} sites, `verifiedOn` says where the check ran).",
           ""]
    open(os.path.join(PROOFS, "sites-blaxel.md"), "w").write("\n".join(md) + "\n")
    wall.sort(key=lambda w: (w["verifiedOn"] != "blaxel", w["category"], w["site"]))
    json.dump(wall, open(os.path.join(PROOFS, "wall.json"), "w"), indent=1)
    print(f"{n_new} sites, {ok_new} ok on blaxel, {ver_new} verified; combined {ok_new + ok_old} ok; wall {len(wall)}; built-ins added {len(added)}")


main(sys.argv[1:])
