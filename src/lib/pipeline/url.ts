const TRACKING_PARAMS = new Set([
  "ref",
  "ref_src",
  "ref_url",
  "source",
  "spm",
  "from",
  "share",
  "share_source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "feature",
  "si",
  "scene",
  "srcid",
  "via",
  "view_from",
]);

const GITHUB_RESERVED = new Set([
  "about", "apps", "collections", "events", "explore", "features", "issues", "login", "marketplace",
  "notifications", "orgs", "pricing", "pulls", "search", "settings", "sponsors", "topics", "trending",
]);

const HF_RESERVED = new Set([
  "blog", "papers", "spaces", "datasets", "docs", "models", "organizations", "settings", "pricing", "learn",
  "join", "login", "posts", "collections", "tasks", "api", "chat",
]);

export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  u.hash = "";
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  for (const key of [...u.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  const query = u.searchParams.toString();
  return `${u.hostname}${path}${query ? `?${query}` : ""}`;
}

/**
 * Stable identity for an item. Repos, papers and models map to the same key no matter which
 * source links to them, so GitHub Trending, HN and Reddit posts about one repo collapse together.
 */
export function keyFromUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return `url:${raw.trim()}`;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segments = u.pathname.split("/").filter(Boolean);

  if (host === "github.com" && segments.length >= 2 && !GITHUB_RESERVED.has(segments[0].toLowerCase())) {
    return `gh:${segments[0]}/${segments[1].replace(/\.git$/, "")}`.toLowerCase();
  }
  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const m = u.pathname.match(/\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})/);
    if (m) return `arxiv:${m[1]}`;
  }
  if (host === "huggingface.co" || host === "hf.co") {
    if (segments[0] === "papers" && /^\d{4}\.\d{4,5}$/.test(segments[1] ?? "")) return `arxiv:${segments[1]}`;
    if (segments.length === 2 && !HF_RESERVED.has(segments[0])) return `hf:${segments[0]}/${segments[1]}`.toLowerCase();
  }
  if (host === "news.ycombinator.com" && u.searchParams.get("id")) {
    return `hn:${u.searchParams.get("id")}`;
  }
  return `url:${normalizeUrl(raw)}`;
}

export function hashKey(key: string): string {
  let h1 = 0xdeadbeef ^ key.length;
  let h2 = 0x41c6ce57 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
