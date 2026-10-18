# clify real-site agent handoff results

Discovery (before the tasks):

- Command: `ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify list'`
- Key output: sites `books`, `hnsearch`, `httpbinform`, `quotes`.
- Help commands run: `ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify books'`, and the same command with `quotes`, `hnsearch`, and `httpbinform`. These printed each site's JSON command help.

## Task 1 — Books: 3rd book on full catalogue page 3

Command:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify books list-books --page "3"'
```

Key JSON output (trimmed):

```json
{"ok":true,"status":200,"data":[
  {"title":"Slow States of Collapse: Poems","price":"£57.31"},
  {"title":"Reasons to Stay Alive","price":"£26.41"},
  {"title":"Private Paris (Private #10)","price":"£47.61"}
]}
```

Answer: **Private Paris (Private #10) — £47.61.**

## Task 2 — Books: first page of category `travel_2`

Command:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify books list-category --category "travel_2"'
```

Key JSON output (trimmed):

```json
{"ok":true,"status":200,"data":[
  {"title":"It's Only the Himalayas","price":"£45.17"},
  {"title":"Full Moon over Noah’s Ark: An Odyssey to Mount Ararat and Beyond","price":"£49.43"},
  {"title":"See America: A Celebration of Our National Parks & Treasured Sites","price":"£48.87"},
  {"title":"Vagabonding: An Uncommon Guide to the Art of Long-Term World Travel","price":"£36.94"},
  {"title":"Under the Tuscan Sun","price":"£37.33"},
  {"title":"A Summer In Europe","price":"£44.34"},
  {"title":"The Great Railway Bazaar","price":"£30.54"},
  {"title":"A Year in Provence (Provence #1)","price":"£56.88"},
  {"title":"The Road to Little Dribbling: Adventures of an American in Britain (Notes From a Small Island #2)","price":"£23.21"},
  {"title":"Neither Here nor There: Travels in Europe","price":"£38.95"},
  {"title":"1,000 Places to See Before You Die","price":"£26.08"}
]}
```

Answer: **11 books. The cheapest is The Road to Little Dribbling: Adventures of an American in Britain (Notes From a Small Island #2) — £23.21.**

## Task 3 — Quotes: first `humor` quote author

Commands:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify quotes by-tag --tag "humor"'
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify quotes get-author --slug "Jane-Austen"'
```

Key JSON output (trimmed):

```json
{"ok":true,"status":200,"data":[
  {"text":"“The person, be it gentleman or lady, who has not pleasure in a good novel, must be intolerably stupid.”","author":"Jane Austen"}
]}
{"ok":true,"status":200,"data":{
  "name":"Jane Austen",
  "born":"December 16, 1775",
  "location":"in Steventon Rectory, Hampshire, The United Kingdom"
}}
```

Answer: **Jane Austen was born December 16, 1775, in Steventon Rectory, Hampshire, The United Kingdom.**

## Task 4 — HN search: highest-points story matching `sqlite`

Command:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify hnsearch search --query "sqlite" --tags "story" --hitsPerPage "10"'
```

Key JSON output (the top 10 titles and points):

```json
[
  {"title":"Hosting SQLite databases on GitHub Pages or any static file hoster","points":1812},
  {"title":"I'm all-in on server-side SQLite","points":1353},
  {"title":"Tracking down the 16-year-old WAL-reset SQLite bug","points":1223},
  {"title":"SQLite is not a toy database","points":986},
  {"title":"How SQL Database Engines Work, by the Creator of SQLite (2008) [video]","points":813},
  {"title":"DuckDB – An embeddable SQL database like SQLite, but supports Postgres features","points":801},
  {"title":"A hackable AI assistant using a single SQLite table and a handful of cron jobs","points":800},
  {"title":"Show HN: Static.wiki – read-only Wikipedia using a 43GB SQLite file","points":796},
  {"title":"SQLite developer must have received a lot of phone calls","points":792},
  {"title":"Why SQLite Uses Bytecode","points":790}
]
```

Answer: **Hosting SQLite databases on GitHub Pages or any static file hoster — 1,812 points.**

## Task 5 — HN item 1 author's karma

Commands:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify hnsearch get-item --id "1"'
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify hnsearch get-user --username "pg"'
```

Key JSON output (trimmed):

```json
{"ok":true,"status":200,"data":{"id":1,"author":"pg","points":57,"title":"Y Combinator"}}
{"ok":true,"status":200,"data":{"about":"Bug fixer.","karma":157316,"username":"pg"}}
```

Answer: **The poster is `pg`, whose karma is 157,316.**

## Task 6 — httpbin order confirmation behavior

(a) Without `--yes`:

Command:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify httpbinform place-order --custname "handoff agent" --size "large"'
```

Key JSON output:

```json
{
  "ok":false,
  "status":0,
  "needsConfirmation":true,
  "preview":{"method":"POST","url":"https://httpbin.org/post","body":{"custname":"handoff agent","size":"large"}},
  "error":"\"place-order\" changes data on httpbin.org. Nothing was sent. Check the preview, then re-run with --yes to send it."
}
```

Answer: **It did not send anything; it returned a dry-run preview and instructed me to rerun with `--yes`.**

(b) With `--yes`:

Command:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify httpbinform place-order --custname "handoff agent" --size "large" --yes'
```

Key JSON output:

```json
{"ok":true,"status":200,"data":{"custname":"handoff agent","size":"large"}}
```

Answer: **The confirmed request succeeded and echoed `custname=handoff agent`, `size=large`.**

## Task 7 — Invalid call

Command:

```sh
ssh build-box 'cd ~/clify-dev && CLIFY_HOME=~/clify-home bin/clify hnsearch search --query "sqlite" --tags "bogus"'
```

Key JSON output:

```json
{"ok":false,"status":0,"url":"/api/v1/search","data":null,
 "error":"--tags must be one of: story, comment, ask_hn, show_hn, poll"}
```

Answer: **Yes. The error directly explained how to fix the enum by listing the allowed values.**

## Usability notes

- The initial `list` and per-site JSON help were enough to discover the available commands and parameters without reading implementation files.
- The help clearly marked `place-order` as a write and said it uses a dry-run preview unless `--yes`; the preview also made the exact POST body visible.
- The books and quotes outputs were straightforward arrays, but pagination semantics were implicit in the command summaries (for example, “20 per page” and “10 per page”).
- The HN result objects were verbose (highlight metadata, child ID arrays, and timestamps), so finding the relevant `title` and `points` required scanning the returned objects. The CLI did not provide a sort-by-points option; requesting 10 hits and comparing them worked.
- The invalid enum error was especially usable because it listed valid values. No failures occurred in the requested tasks.
