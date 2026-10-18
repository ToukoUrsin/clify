// Minimal XML → JSON (RSS, Atom, sitemaps, SOAP-ish APIs) so XML responses go
// through resultPath like JSON. Elements become keys, repeated elements arrays,
// attributes "@name", text "#text" when an element also has children or
// attributes, otherwise the element is just its text.
type Node = { [k: string]: unknown };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

export function looksLikeXml(contentType: string, text: string): boolean {
  return (/xml|rss|atom/i.test(contentType) && !/html/i.test(contentType)) || /^\s*<\?xml/.test(text);
}

export function xmlToJson(xml: string): unknown {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const root: Node = {};
  const stack: { name: string; node: Node; text: string }[] = [{ name: "#root", node: root, text: "" }];
  let m: RegExpExecArray | null;
  const add = (parent: Node, name: string, value: unknown) => {
    if (name in parent) {
      const cur = parent[name];
      parent[name] = Array.isArray(cur) ? [...cur, value] : [cur, value];
    } else parent[name] = value;
  };
  const finish = (fr: { name: string; node: Node; text: string }): unknown => {
    const text = fr.text.trim();
    const keys = Object.keys(fr.node);
    if (!keys.length) return text;
    if (text) fr.node["#text"] = text;
    return fr.node;
  };
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      // close tag: pop to the matching element
      let i = stack.length - 1;
      while (i > 0 && stack[i].name !== m[2]) i--;
      if (i === 0) continue;
      while (stack.length > i) {
        const fr = stack.pop()!;
        add(stack[stack.length - 1].node, fr.name, finish(fr));
      }
    } else if (m[3]) {
      const node: Node = {};
      for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node["@" + a[1]] = decode(a[2] ?? a[3] ?? "");
      if (m[5] === "/") add(top.node, m[3], Object.keys(node).length ? node : "");
      else stack.push({ name: m[3], node, text: "" });
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  while (stack.length > 1) {
    const fr = stack.pop()!;
    add(stack[stack.length - 1].node, fr.name, finish(fr));
  }
  return root;
}
