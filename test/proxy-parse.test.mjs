// data/proxy-use.json identifies a proxy only by its index, because indices are
// safe to commit to a public repo and hostnames are not. That makes the index
// the only handle anyone has on "which proxy is this", so the collector and the
// diagnostic tool have to number the list identically. They did not: each had
// its own parser, and they disagreed on newlines, on bare host:port entries and
// on whether a URL needed credentials. Any of those shifted every index after
// the offending line, so looking up a reported index gave the wrong proxy.
import test from "node:test";
import assert from "node:assert/strict";
import { parseProxies, unauthenticatedIndices } from "../scripts/proxies.mjs";

const hosts = (env) => parseProxies(env).map((p) => p.server);

test("entries keep the order they appear in the secret", () => {
  const env = { PROXY_LIST: "a.example:1:u:p,b.example:2:u:p,c.example:3:u:p" };
  assert.deepEqual(hosts(env), ["http://a.example:1", "http://b.example:2", "http://c.example:3"]);
});

test("newline-separated lists parse the same as comma-separated", () => {
  const commas = { PROXY_LIST: "a.example:1:u:p,b.example:2:u:p" };
  const lines = { PROXY_LIST: "a.example:1:u:p\nb.example:2:u:p" };
  const mixed = { PROXY_LIST: "a.example:1:u:p,\n b.example:2:u:p\n" };
  assert.deepEqual(hosts(lines), hosts(commas));
  assert.deepEqual(hosts(mixed), hosts(commas));
});

test("a bare host:port keeps its slot and never carries our credentials", () => {
  // The old diagnostic dropped these, which shifted every index after them.
  const env = { PROXY_LIST: "a.example:1:u:p,open.example:8080,c.example:3:u:p", PROXY_USER: "u", PROXY_PASS: "p" };
  const out = parseProxies(env);
  assert.equal(out.length, 3);
  assert.equal(out[1].server, "http://open.example:8080");
  assert.equal(out[1].username, undefined);
  assert.equal(out[1].password, undefined);
  assert.equal(out[2].server, "http://c.example:3");
});

test("URL form parses with or without credentials, and keeps its slot", () => {
  const env = { PROXY_LIST: "http://u:p@a.example:1,http://b.example:2,c.example:3:u:p" };
  const out = parseProxies(env);
  assert.deepEqual(out.map((p) => p.server), ["http://a.example:1", "http://b.example:2", "http://c.example:3"]);
  assert.equal(out[0].username, "u");
  assert.equal(out[1].username, undefined);
});

test("blank entries are skipped without consuming an index", () => {
  const env = { PROXY_LIST: "a.example:1:u:p,,\n\n b.example:2:u:p ," };
  assert.deepEqual(hosts(env), ["http://a.example:1", "http://b.example:2"]);
});

test("PROXY_HOST plus PROXY_PORTS numbers by port order", () => {
  const env = { PROXY_HOST: "h.example", PROXY_PORTS: "10, 11 ,12", PROXY_USER: "u", PROXY_PASS: "p" };
  const out = parseProxies(env);
  assert.deepEqual(out.map((p) => p.server), ["http://h.example:10", "http://h.example:11", "http://h.example:12"]);
  assert.equal(out[2].username, "u");
});

test("PROXY_LIST wins outright, so a stale host/ports pair cannot rejoin the rotation", () => {
  const env = { PROXY_LIST: "a.example:1:u:p", PROXY_HOST: "old.example", PROXY_PORTS: "1,2,3" };
  assert.deepEqual(hosts(env), ["http://a.example:1"]);
});

test("nothing configured parses to nothing", () => {
  assert.deepEqual(parseProxies({}), []);
});

test("index 8 is the ninth entry, whatever the formats before it are", () => {
  const entries = [
    "a.example:1:u:p", "http://u:p@b.example:2", "c.example:3", "d.example:4:u:p",
    "e.example:5:u:p", "http://f.example:6", "g.example:7:u:p", "h.example:8:u:p",
    "target.example:9:u:p", "j.example:10:u:p",
  ];
  const out = parseProxies({ PROXY_LIST: entries.join("\n") });
  assert.equal(out[8].server, "http://target.example:9");
});

test("unauthenticatedIndices names the entries that carry no credentials", () => {
  // The mixed case is the one worth catching: a four-field entry mistyped into
  // two parses fine, keeps its slot, and then fails auth on every attempt.
  const mixed = parseProxies({ PROXY_LIST: "a.example:1:u:p,open.example:8080,c.example:3:u:p" });
  assert.deepEqual(unauthenticatedIndices(mixed), [1]);

  // A deliberate no-auth fleet is not a mistake, so callers gate on "some but
  // not all" rather than on this being non-empty.
  const none = parseProxies({ PROXY_LIST: "a.example:1,b.example:2" });
  assert.deepEqual(unauthenticatedIndices(none), [0, 1]);

  const all = parseProxies({ PROXY_LIST: "a.example:1:u:p,b.example:2:u:p" });
  assert.deepEqual(unauthenticatedIndices(all), []);

  // The URL form without credentials counts too, and indices stay absolute.
  const url = parseProxies({ PROXY_LIST: "http://u:p@a.example:1,http://b.example:2" });
  assert.deepEqual(unauthenticatedIndices(url), [1]);
});
