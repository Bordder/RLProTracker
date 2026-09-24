// writeRows, lifted out of web/rlpt.js as the page ships it.
//
// The page is a plain script with no modules, so the function is read from
// the source and evaluated on its own, the way board-feeds.test.mjs reads the
// feed list. It depends on nothing else in the file.
//
// The property that matters: a repaint that skips the write must leave the
// body as a fresh write would have. The panel restore after a refresh reopens
// a team by toggling it, and toggling a row whose panel is still there closes
// it instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile("web/rlpt.js", "utf8");
const at = src.indexOf("var writeRows=function");
assert.notEqual(at, -1, "writeRows not found in web/rlpt.js");
const end = src.indexOf("\n  };", at);
const writeRows = new Function(`${src.slice(at, end + 4)}\nreturn writeRows;`)();

// Just enough of a tbody: rows with classes and attributes, and the three
// selectors writeRows asks for.
function el(cls = [], attrs = {}) {
  const e = {
    classes: new Set(cls), attrs: new Map(Object.entries(attrs)), children: [], parentNode: null,
    classList: { remove: (c) => e.classes.delete(c), add: (c) => e.classes.add(c) },
    hasAttribute: (n) => e.attrs.has(n),
    setAttribute: (n, v) => e.attrs.set(n, v),
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
  };
  return e;
}
function tbody() {
  const tb = el();
  let html = "";
  tb.writes = 0;
  Object.defineProperty(tb, "innerHTML", {
    get: () => html,
    set: (v) => {
      html = v; tb.writes++;
      // A fresh write: one closed row per <tr>, each with a copy button.
      tb.children = [...v.matchAll(/<tr( aria-expanded="false")?/g)].map((m) => {
        const r = el(["row"], m[1] ? { "aria-expanded": "false" } : {});
        r.parentNode = tb;
        r.children = [el(["copyrow"])];
        return r;
      });
    },
  });
  const all = () => tb.children.flatMap((r) => [r, ...r.children]);
  tb.querySelectorAll = (sel) => {
    if (sel === "tr.pexp,tr.exp-row") return tb.children.filter((r) => r.classes.has("pexp") || r.classes.has("exp-row"));
    if (sel === "tr.open") return tb.children.filter((r) => r.classes.has("open"));
    if (sel === ".copyrow.done") return all().filter((x) => x.classes.has("copyrow") && x.classes.has("done"));
    throw new Error(`unexpected selector ${sel}`);
  };
  return tb;
}
const ROWS = '<tr aria-expanded="false"><td>a</td></tr><tr aria-expanded="false"><td>b</td></tr>';

test("identical rows are not written twice", () => {
  const tb = tbody();
  assert.equal(writeRows(tb, ROWS), true);
  assert.equal(writeRows(tb, ROWS), false);
  assert.equal(writeRows(tb, ROWS), false);
  assert.equal(tb.writes, 1);
});

test("different rows are written", () => {
  const tb = tbody();
  writeRows(tb, ROWS);
  assert.equal(writeRows(tb, '<tr aria-expanded="false"><td>c</td></tr>'), true);
  assert.equal(tb.writes, 2);
  assert.equal(writeRows(tb, ""), true, "an empty search result is still written");
  assert.equal(tb.children.length, 0);
});

test("a skipped write clears what clicks added, as a fresh write would", () => {
  const tb = tbody();
  writeRows(tb, ROWS);
  const [a] = tb.children;
  // A team opened: the row marked, its panel inserted after it.
  a.classes.add("open"); a.setAttribute("aria-expanded", "true");
  const panel = el(["exp-row"]); panel.parentNode = tb;
  tb.children.splice(1, 0, panel);
  // A player panel and a copy tick on the other row.
  const pexp = el(["pexp"]); pexp.parentNode = tb;
  tb.children.push(pexp);
  tb.children[2].children[0].classes.add("done");

  assert.equal(writeRows(tb, ROWS), false);
  assert.equal(tb.writes, 1);
  assert.equal(tb.children.length, 2, "an inserted panel survived the repaint");
  for (const r of tb.children) {
    assert.equal(r.classes.has("open"), false);
    assert.equal(r.attrs.get("aria-expanded"), "false");
    assert.equal(r.children[0].classes.has("done"), false);
  }
});

test("a row that never carried aria-expanded is not given one", () => {
  const tb = tbody();
  writeRows(tb, "<tr><td>p</td></tr>");
  tb.children[0].classes.add("open");
  writeRows(tb, "<tr><td>p</td></tr>");
  assert.equal(tb.children[0].hasAttribute("aria-expanded"), false);
  assert.equal(tb.children[0].classes.has("open"), false);
});
