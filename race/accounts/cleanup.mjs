#!/usr/bin/env node
// Remove race objects from the agent's dashboards: node race/accounts/cleanup.mjs [prefix ...]
// Default prefix race- (every race run). Also runs the session preflight.
import {cleanup, preflight} from './checks.mjs';
const prefixes = process.argv.slice(2);
console.log(JSON.stringify(await cleanup(prefixes.length ? prefixes : undefined), null, 2));
const bad = await preflight();
console.log(bad.length ? `PREFLIGHT FAILED\n${bad.join('\n')}` : 'preflight ok: all saved sessions work');
process.exit(bad.length ? 1 : 0);
