#!/usr/bin/env python3
"""Hand-written specs for the benchmark sites (public, read-only, robots-checked).
Backs up any existing lane spec to spec.lane.json first."""
import json, os, shutil, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.join(os.environ.get("BENCH_CLIFY_HOME", os.path.join(HERE, ".clify-home")), "sites")
REPO = os.path.join(HERE, "..", "clify", "test", "real")
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

def p(name, typ="string", required=True, where="path", desc=None, default=None):
    d = {"name": name, "in": where, "required": required, "type": typ}
    if desc: d["description"] = desc
    if default is not None: d["default"] = default
    return d

def cmd(name, summary, url, rtype="json", params=(), example=None, **kw):
    c = {"name": name, "summary": summary, "method": "GET", "urlTemplate": url, "responseType": rtype, "mutates": False, "params": list(params)}
    if example: c["example"] = example
    c.update(kw)
    return c

specs = {}

books = json.load(open(f"{REPO}/books.spec.json"))
books["commands"].insert(2, cmd("list-category-page", "Page N (2 or more) of a category; page 1 is list-category", "/catalogue/category/books/{category}/page-{page}.html", "html",
    [p("category", desc="category slug, e.g. mystery_3"), p("page", "number")],
    {"category": "mystery_3", "page": "2"},
    extract={"list": "article.product_pod", "fields": {"title": "h3 a@title", "price": ".price_color", "url": "h3 a@href"}}))
for c in books["commands"]:
    if c["name"] == "list-category":
        c["summary"] = "Books in one category, page 1 (20 per page; slug like mystery_3, travel_2)"
specs["books"] = books

quotes = json.load(open(f"{REPO}/quotes.spec.json"))
for c in quotes["commands"]:
    if c["name"] == "by-tag":
        c["extract"]["fields"]["authorUrl"] = "span a@href"
specs["quotes"] = quotes

specs["scrapethis"] = json.load(open(f"{REPO}/scrapethis.spec.json"))

specs["hex"] = {
    "name": "hex", "startUrl": "https://hex.pm/", "origin": "https://hex.pm", "createdAt": NOW,
    "description": "Hex, the Elixir/Erlang package registry: package metadata and search (the JSON behind hex.pm pages).",
    "commands": [
        cmd("get-package", "Package metadata: latest stable version, licenses, links, downloads", "/api/packages/{name}", params=[p("name")], example={"name": "phoenix"}),
        cmd("search", "Search packages by name", "/api/packages", params=[p("search", where="query"), p("sort", where="query", required=False, desc="name, recent_downloads, total_downloads, inserted_at, updated_at")], example={"search": "ecto"}),
    ],
}

specs["debian"] = {
    "name": "debian", "startUrl": "https://packages.debian.org/", "origin": "https://packages.debian.org", "createdAt": NOW,
    "description": "Debian package pages: the version of a package in a given suite (bookworm, trixie, sid ...).",
    "commands": [
        cmd("package", "One package in one suite; heading shows the version", "/{suite}/{name}", "html", [p("suite", desc="bookworm, trixie, forky, sid, bullseye"), p("name")], {"suite": "bookworm", "name": "nginx"},
            extract={"fields": {"heading": "#content h1", "summary": "#pdesc h2", "suites": "#pothers"}}),
        cmd("search", "Search package names in a suite", "/search", "html", [p("keywords", where="query"), p("suite", where="query", required=False, default="all"), p("searchon", where="query", required=False, default="names")], {"keywords": "nginx"},
            extract={"list": "#psearchres ul li", "fields": {"name": "a", "url": "a@href", "versions": "br"}}),
    ],
}

gh = json.load(open(os.path.join(HOME, "github", "spec.json")))
gh["commands"] = [c for c in gh["commands"] if c["name"] in ("repo", "search")]
gh["commands"] += [
    cmd("latest-release", "Latest published release of a repository (tag, name, date)", "/repos/{owner}/{repo}/releases/latest", params=[p("owner"), p("repo")], example={"owner": "microsoft", "repo": "playwright"}),
    cmd("releases", "Recent releases of a repository", "/repos/{owner}/{repo}/releases", params=[p("owner"), p("repo"), p("per_page", "number", False, "query", default=10)], example={"owner": "microsoft", "repo": "playwright"}),
]
specs["github"] = gh

specs["webscraper"] = {
    "name": "webscraper", "startUrl": "https://webscraper.io/test-sites/e-commerce/allinone", "origin": "https://webscraper.io", "createdAt": NOW,
    "description": "Web Scraper's test e-commerce site (a scraping sandbox): products by category with prices and reviews.",
    "commands": [
        cmd("products", "All products in a category (computers/laptops, computers/tablets, phones/touch)", "/test-sites/e-commerce/allinone/{section}/{category}", "html", [p("section", desc="computers or phones"), p("category", desc="laptops, tablets (computers) or touch (phones)")], {"section": "computers", "category": "laptops"},
            extract={"list": "div.thumbnail", "fields": {"title": "a.title@title", "price": ".price", "description": ".description", "reviews": ".ratings p.review-count", "url": "a.title@href"}}),
    ],
}

crates = json.load(open(os.path.join(HOME, "crates", "spec.json")))
if not any(c["name"] == "version" for c in crates["commands"]):
    crates["commands"].append(cmd("version", "One published version of a crate: license, date, downloads", "/api/v1/crates/{name}/{version}", params=[p("name"), p("version")], example={"name": "serde", "version": "1.0.0"}, resultPath="version"))
for c in crates["commands"]:
    if c["name"] == "get-crate":
        c["summary"] = "Crate metadata (max_stable_version, newest_version, description, downloads)"
specs["crates"] = crates

for site, spec in specs.items():
    d = os.path.join(HOME, site)
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, "spec.json")
    if os.path.exists(f) and not os.path.exists(os.path.join(d, "spec.lane.json")):
        shutil.copy(f, os.path.join(d, "spec.lane.json"))
    spec["name"] = site
    json.dump(spec, open(f, "w"), indent=2)
    print("wrote", f)
