# Clify benchmark

`benchmark.mjs` repeats the same read-only task through two paths:

> Return the first three Mystery books from Books to Scrape, with title and price.

- **Clify:** one JSON CLI command backed by the recorded HTML spec.
- **Direct browser:** headless Chrome navigates to the same public page and extracts the same fields.

Run from the repository with:

```sh
CLIFY_HOME=/tmp/clify-bench CLIFY_BENCH_TRIALS=5 node test/benchmark/benchmark.mjs
```

The output and `last-run.json` report exact success count, p50/p95 wall time, and action count. It is evidence for this task and site only; it does not prove universal perfection. The task is read-only and uses no login, CAPTCHA interaction, account creation, or write.
