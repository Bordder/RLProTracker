// How PROXY_LIST / PROXY_HOST+PROXY_PORTS become an ordered list of proxies.
//
// Shared, and that is the point. The collector and checkProxies.mjs each had
// their own copy, and they disagreed in three ways: only the collector split on
// newlines, only the collector accepted a bare "host:port" entry, and their URL
// patterns differed on whether credentials were required. Any of those made the
// diagnostic tool drop or merge an entry, which shifted every index after it.
//
// That matters more than it sounds. data/proxy-use.json records proxies by
// index, because indices are safe to commit to a public repo where hostnames
// are not, so an index is the only handle anyone has on "which proxy is this".
// If the tool you use to look up index 8 numbers its list differently from the
// collector that reported index 8, the answer is quietly the wrong proxy.
//
// ORDER IS THE IDENTITY. Index 8 means the ninth entry parsed from the secret.
// Appending is safe; inserting or removing a line renumbers everything after it
// and silently invalidates the history in proxy-use.json.

// Returns [{ server, username?, password? }] in secret order, or [] when
// nothing is configured. Never logs a value: callers decide what is safe to
// print in their context.
export function parseProxies(env = process.env) {
  const out = [];

  // Format A: PROXY_LIST - one proxy per line or comma. Accepts
  // "host:port:user:pass", "host:port" (uses PROXY_USER/PASS), or
  // "http://user:pass@host:port". Lets us mix providers to spread bandwidth
  // across their separate caps.
  const list = env.PROXY_LIST;
  if (list) {
    for (const raw of list.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
      const url = raw.match(/^https?:\/\/(?:([^:@]+):([^@]+)@)?([^:/]+):(\d+)/);
      if (url) { out.push({ server: `http://${url[3]}:${url[4]}`, username: url[1], password: url[2] }); continue; }
      const p = raw.split(":");
      if (p.length >= 4) out.push({ server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(":") });
      // A bare host:port is a public or no-auth proxy: never attach our creds.
      else if (p.length === 2) out.push({ server: `http://${p[0]}:${p[1]}` });
    }
  }

  // Format B: PROXY_HOST + PROXY_PORTS (one host, many ports, shared creds).
  //
  // Only consulted when PROXY_LIST is absent. These used to be concatenated,
  // which meant a stale secret from a previous provider quietly rejoined the
  // rotation and every player unlucky enough to draw one of those slots spent
  // its attempts on a dead tunnel.
  const host = env.PROXY_HOST, ports = env.PROXY_PORTS;
  if (!out.length && host && ports) {
    const username = env.PROXY_USER, password = env.PROXY_PASS;
    for (const pt of ports.split(",")) out.push({ server: `http://${host}:${pt.trim()}`, username, password });
  }

  return out;
}
