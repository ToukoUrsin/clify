// The spec is the whole contract: it is what `clify make` writes and what the
// generated CLI (and the MCP server) reads to run commands. It is self-describing
// so an agent can `<site> --help` once and know everything.

export interface ParamSpec {
  name: string; // flag name: --name (letters, digits, _)
  key?: string; // name on the wire when it differs ("filter[type]", "page.size", "X-Api-Version")
  in: "query" | "path" | "body" | "header";
  required: boolean;
  type: "string" | "number" | "boolean";
  description?: string;
  example?: unknown;
  default?: string | number | boolean; // sent when the agent omits the flag
  enum?: string[]; // allowed values seen in the UI (filter options, sort keys)
  // Key in SiteSpec.context: when the agent omits the flag, the signed-in
  // account's value (current project/org/team...) is sent.
  context?: string;
}

export interface CommandSpec {
  name: string; // kebab-case verb the agent types, e.g. "list-tenders"
  summary: string;
  method: string; // GET/POST/...
  // URL template with {param} placeholders. Relative to the site origin unless absolute.
  urlTemplate: string;
  params: ParamSpec[];
  // Static body merged under the agent-supplied body params (for endpoints
  // that always need a fixed envelope). Values may contain {param} refs.
  bodyTemplate?: Record<string, unknown>;
  bodyEncoding?: "json" | "form" | "none";
  // Static headers this endpoint needs (accept, x-requested-with...).
  headers?: Record<string, string>;
  responseType: "json" | "html" | "text";
  // JSON path (dot notation) to the array/field worth showing by default.
  resultPath?: string;
  // For HTML responses: CSS extraction. fields values are "selector" (text) or
  // "selector@attr"; "" means the item itself.
  // jsonScript: CSS selector of a <script> holding JSON (Next.js __NEXT_DATA__,
  // ld+json); its parsed content then goes through resultPath like a JSON API.
  extract?: { list?: string; fields?: Record<string, string>; jsonScript?: string };
  // Fields shown when the agent does not pass --fields (keeps output small).
  // `--fields '*'` shows everything.
  defaultFields?: string[];
  // How to get the next page. page/offset: add `step` (default 1 / item count)
  // to `param`. cursor: the next value is at `nextPath` (dot path in the raw
  // JSON response, before resultPath).
  pagination?: { type: "page" | "offset" | "cursor"; param: string; step?: number; nextPath?: string };
  // Fetch-then-submit CSRF: GET `from` first (with the session), read the token
  // with `selector` ("css@attr", e.g. "input[name=csrf]@value" or
  // "meta[name=csrf-token]@content"), `jsonPath` or `cookie`, then send it as
  // body field `field` and/or header `header`.
  csrf?: { from: string; selector?: string; jsonPath?: string; cookie?: string; field?: string; header?: string };
  // true if the request creates, changes or deletes data. Such commands only
  // send with an explicit confirmation (--yes / confirm:true); otherwise they
  // return a dry-run preview of the exact request.
  mutates: boolean;
  // Needs the logged-in session (`clify login`).
  auth?: boolean;
  example?: Record<string, string>; // args used to verify the command
  verified?: boolean;
  verifyNote?: string;
  aliases?: string[]; // other names for the same request (collapsed near-duplicates)
  // From the verified live call: the default-field output of its first item
  // (secrets masked) and every field the result has, so an agent knows what
  // comes back without a trial call.
  sample?: string;
  resultFields?: string[];
  source?: string; // "METHOD url" of the recorded request it came from
}

export interface AuthSpec {
  // Non-cookie headers replayed from the saved session (authorization, x-csrf-token...).
  headerNames: string[];
  loginUrl?: string;
}

export interface SiteSpec {
  name: string;
  startUrl: string;
  origin: string;
  createdAt: string;
  description: string;
  commands: CommandSpec[];
  auth?: AuthSpec;
  notes?: string[];
  // Read commands that failed verification (kept for `clify repair`, hidden from agents).
  dropped?: CommandSpec[];
  // Why exploration stopped early (captcha, needs-account...), if it did.
  blockers?: string[];
  // Values that are constant for the signed-in account (current project,
  // organization, team, user id...), found by `clify add` in the recorded
  // traffic and confirmed live. Params with `context` default to them.
  context?: Record<string, ContextValue>;
  // How the spec was made: exploration and verification stats.
  generated?: { by: string; model?: string; exploredSteps?: number; recorded?: number; verifiedAt?: string; seconds?: number };
}

export interface ContextValue {
  value: string;
  from: string; // how it was found: "only item of list-projects", "same on every recorded request"
}

// One captured HTTP exchange from the browser.
export interface Exchange {
  method: string;
  url: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  contentType?: string;
  responseSample?: string; // head of the response body (cleaned HTML for pages)
  resourceType?: string; // xhr, fetch, document, ...
  triggeredBy?: string; // label of the button/action that caused it
  held?: boolean; // a write the recorder blocked (never sent)
  jsonScripts?: { selector: string; size: number; sample: string }[]; // JSON embedded in an HTML page
  sent?: boolean; // a write that was let through (login submit, or --allow-writes)
  withSession?: boolean; // recorded while logged in
}

// The user's own existing account for a site. clify never creates accounts.
export interface Credentials {
  username: string;
  password: string;
}

// Saved login state: cookies from the browser plus non-cookie auth headers.
export interface Session {
  cookies: { name: string; value: string; domain: string; path: string; expires: number }[];
  headers: Record<string, string>;
  updatedAt: string;
}
