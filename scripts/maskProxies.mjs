// Tell the Actions runner to redact every proxy endpoint from this job's log.
//
// GitHub masks a registered secret only as a WHOLE value. One host:port is a
// substring of PROXY_LIST, so it is not covered and would print in clear. This
// repo is public, so its Actions logs are public with it.
//
// Prints only ::add-mask:: directives, which the runner consumes and does not
// display. Run it before anything that could touch an address.
import { parseProxies } from "./proxies.mjs";
for (const p of parseProxies()) {
  const hostPort = (p?.server ?? "").replace(/^https?:\/\//, "");
  if (!hostPort) continue;
  console.log(`::add-mask::${hostPort}`);
  console.log(`::add-mask::${hostPort.split(":")[0]}`);
}
