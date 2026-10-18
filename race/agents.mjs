// Racer adapters. Each one launches an agent CLI on one tool surface and turns
// its output into the same callbacks: model, usage (cumulative), text, tool,
// toolResult, final. Both racers in a run always use the same adapter + model.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// List prices, USD per million tokens. Claude Code
// writes its prompt cache with the 1-hour TTL, billed at 2x input.
export const RATES = {
  'claude-opus-5-5': {input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8},
  'gpt-6.1-sol': {input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 2.5},
};
export function costOf(model, u) {
  const r = RATES[model]; if (!r) return null;
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + (u.cacheWrite - u.cacheWrite1h) * r.cacheWrite + u.cacheWrite1h * r.cacheWrite1h) / 1e6;
}
export const emptyUsage = () => ({input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0});
export const freshTokens = u => u.input + u.output + u.cacheWrite;
export const totalTokens = u => freshTokens(u) + u.cacheRead;

const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.83';
// Mode A ("ui", clicks + screenshots) removes the tools that run JavaScript in
// the page; mode B ("js") keeps the full Playwright MCP.
export const PAGE_JS_TOOLS = ['browser_evaluate', 'browser_run_code_unsafe', 'browser_run_code'];
const toolText = c => Array.isArray(c) ? c.map(x => x.text || (x.type === 'image' ? '[image]' : '')).join('\n') : String(c ?? '');

const CLAUDE_BUILTINS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit', 'TodoWrite', 'KillShell', 'BashOutput', 'Skill'];

const claude = {
  name: 'claude', model: 'claude-opus-5-5', label: 'Claude Code · claude-opus-5-5',
  launch({mode, browserMode, prompt, dir, env, cdp}) {
    const args = ['-p', prompt, '--model', this.model, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence', '--permission-mode', 'bypassPermissions', '--max-turns', '300', '--strict-mcp-config'];
    const mcp = path.join(dir, 'mcp.json');
    if (mode === 'browser') {
      fs.writeFileSync(mcp, JSON.stringify({mcpServers: {playwright: {command: 'npx', args: ['-y', PLAYWRIGHT_MCP, '--cdp-endpoint', cdp]}}}, null, 2));
      args.push('--mcp-config', mcp, '--disallowed-tools', ...CLAUDE_BUILTINS, ...(browserMode === 'ui' ? PAGE_JS_TOOLS.map(t => `mcp__playwright__${t}`) : []));
    } else {
      fs.writeFileSync(mcp, JSON.stringify({mcpServers: {}}));
      args.push('--mcp-config', mcp, '--tools', mode === 'curl' ? 'Bash,WebFetch,WebSearch' : 'Bash');
    }
    const e = {...env}; delete e.ANTHROPIC_API_KEY; // Claude Code uses its own login (or apiKeyHelper), not a key from the env
    return {child: spawn('nice', ['-n', '10', 'claude', ...args], {cwd: dir, env: e, stdio: ['ignore', 'pipe', 'pipe']})};
  },
  // Usage per API call: message_start carries input/cache counts, message_delta
  // the final output count; the assistant messages (several per call, same id)
  // only carry a partial output count, so the largest value wins.
  parser(h) {
    const byId = new Map(); let current = null;
    const put = (id, u) => {
      const prev = byId.get(id);
      byId.set(id, {input: +u.input_tokens || 0, output: Math.max(+u.output_tokens || 0, prev?.output || 0), cacheRead: +u.cache_read_input_tokens || 0, cacheWrite: +u.cache_creation_input_tokens || 0, cacheWrite1h: +(u.cache_creation?.ephemeral_1h_input_tokens ?? prev?.cacheWrite1h ?? u.cache_creation_input_tokens) || 0});
      const sum = emptyUsage(); for (const x of byId.values()) for (const k in sum) sum[k] += x[k];
      h.usage(sum, byId.size);
    };
    return {
      line(o) {
        if (o.type === 'stream_event') {
          const e = o.event || {};
          if (e.type === 'message_start' && e.message) { current = e.message.id; if (e.message.model) h.model(e.message.model); if (e.message.usage) put(current, e.message.usage); }
          if (e.type === 'message_delta' && e.usage && current) put(current, e.usage);
          return;
        }
        if (o.type === 'assistant') {
          const m = o.message || {};
          if (m.model) h.model(m.model);
          if (m.usage) put(m.id || `anon${byId.size}`, m.usage);
          for (const c of m.content || []) {
            if (c.type === 'text' && c.text.trim()) h.text(c.text.trim());
            if (c.type === 'tool_use') h.tool({id: c.id, name: c.name.replace(/^mcp__playwright__/, ''), args: c.input || {}});
          }
        }
        if (o.type === 'user') for (const c of o.message?.content || []) if (c.type === 'tool_result') h.toolResult({id: c.tool_use_id, text: toolText(c.content), error: !!c.is_error});
        if (o.type === 'result') {
          for (const m of Object.keys(o.modelUsage || {})) h.model(m);
          h.final({text: String(o.result || ''), reportedCost: Number(o.total_cost_usd || 0), turns: o.num_turns, subtype: o.subtype});
        }
      },
      stop() {},
    };
  },
};

// Codex runs from a private CODEX_HOME: only the model provider block of the
// box's config is copied (no personal MCP servers, no AGENTS.md), plus the
// Playwright MCP for the browser racer. Built-in browsers, web search and
// sub-agents are off for both racers; the browser racer also loses the shell.
const CODEX_OFF = ['browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'image_generation', 'apps', 'plugins', 'tool_suggest', 'multi_agent', 'goals', 'hooks', 'memories', 'daemon_auto_start'];
const codex = {
  name: 'codex', model: 'gpt-6.1-sol', label: 'Codex CLI · gpt-6.1-sol',
  launch({mode, browserMode, prompt, dir, env, cdp}) {
    const home = path.join(dir, 'codex-home'); fs.mkdirSync(home, {recursive: true});
    const base = fs.readFileSync(path.join(os.homedir(), '.codex/config.toml'), 'utf8');
    const provider = base.split(/^\[(?:mcp_servers|projects)\b/m)[0].replace(/^(model|model_reasoning_effort|personality)\s*=.*$/gm, '');
    let cfg = `model = "${this.model}"\nmodel_reasoning_effort = "medium"\n${provider}\n`;
    if (mode === 'browser') cfg += `[mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "${PLAYWRIGHT_MCP}", "--cdp-endpoint", "${cdp}"]\nstartup_timeout_sec = 60\n${browserMode === 'ui' ? `disabled_tools = ${JSON.stringify(PAGE_JS_TOOLS)}\n` : ''}`;
    fs.writeFileSync(path.join(home, 'config.toml'), cfg, {mode: 0o600});
    const off = [...CODEX_OFF, ...(mode === 'browser' ? ['shell_tool', 'unified_exec'] : [])].flatMap(f => ['--disable', f]);
    const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'danger-full-access', '-m', this.model, '-C', dir, '-c', 'web_search="disabled"', ...off, prompt];
    return {home, child: spawn('nice', ['-n', '10', 'codex', ...args], {cwd: dir, env: {...env, CODEX_HOME: home}, stdio: ['ignore', 'pipe', 'pipe']})};
  },
  // The --json stream has tool calls and messages but usage only at the end;
  // per-call token counts are tailed from the session rollout file.
  parser(h, {home}) {
    let rollout = null, offset = 0, rest = '', calls = 0, last = '';
    const find = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, {withFileTypes: true}) : []) { const p = path.join(d, e.name); if (e.isDirectory()) { const f = find(p); if (f) return f; } else if (e.name.endsWith('.jsonl')) return p; } return null; };
    const poll = () => {
      rollout ||= find(path.join(home, 'sessions')); if (!rollout) return;
      const size = fs.statSync(rollout).size; if (size <= offset) return;
      const fd = fs.openSync(rollout, 'r'); const buf = Buffer.alloc(size - offset); fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd); offset = size;
      const lines = (rest + buf.toString('utf8')).split('\n'); rest = lines.pop();
      for (const l of lines) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        const p = o.payload || {};
        if (o.type === 'turn_context' && p.model) h.model(p.model);
        if (o.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
          const t = p.info.total_token_usage, key = JSON.stringify(t); if (key === last) continue; last = key; calls++;
          h.usage({input: (t.input_tokens || 0) - (t.cached_input_tokens || 0), output: t.output_tokens || 0, cacheRead: t.cached_input_tokens || 0, cacheWrite: t.cache_write_input_tokens || 0, cacheWrite1h: 0}, calls);
        }
      }
    };
    const timer = setInterval(poll, 400);
    const texts = [];
    return {
      line(o) {
        const it = o.item;
        if (o.type === 'item.started' && it?.type === 'mcp_tool_call') h.tool({id: it.id, name: it.tool, args: it.arguments || {}});
        if (o.type === 'item.started' && it?.type === 'command_execution') h.tool({id: it.id, name: 'shell', args: {command: it.command.replace(/^\/bin\/bash -lc '([\s\S]*)'$/, '$1')}});
        if (o.type === 'item.completed' && it?.type === 'mcp_tool_call') h.toolResult({id: it.id, text: it.error ? String(it.error.message || it.error) : toolText(it.result?.content), error: !!it.error});
        if (o.type === 'item.completed' && it?.type === 'command_execution') h.toolResult({id: it.id, text: it.aggregated_output || '', error: it.exit_code !== 0});
        if (o.type === 'item.completed' && it?.type === 'agent_message') { texts.push(it.text); h.text(it.text); }
        if (o.type === 'turn.completed' || o.type === 'turn.failed') { poll(); h.final({text: texts.at(-1) || '', reportedCost: null, subtype: o.type}); }
      },
      stop() { poll(); clearInterval(timer); },
    };
  },
};

export const AGENTS = {claude, codex};
