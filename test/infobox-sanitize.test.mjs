// The infobox text comes off a wiki, so it is attacker-controlled.
//
// Anyone with a Liquipedia account can rename an event, and whatever they type
// travels through parseInfobox into bracket.json and onto the page. Three
// layers stand between that and a script running: this strip, the escape the
// page applies before touching the DOM, and a CSP with no 'unsafe-inline'.
// These tests hold the first one.
//
// The bug they exist for is the one CodeQL calls
// js/incomplete-multi-character-sanitization: a rule that deletes a SEQUENCE
// can spell a new one out of the text either side of the hole it leaves, so a
// single pass is not enough.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInfobox } from "../scripts/parseBracket.mjs";

const infobox = (name) => `{{Infobox league\n|name=${name}\n|country=Germany\n}}`;
const nameOf = (raw) => parseInfobox(infobox(raw))?.name ?? null;

test("a tag hidden inside another tag does not survive the strip", () => {
  // What must not come out is a tag. The leftover letters are debris from a
  // name nobody would type, and the test pins the property, not the debris:
  // asserting an exact string here would break on any future strip rule that
  // is equally safe.
  const out = nameOf("<scr<b>ipt>alert(1)</scr<b>ipt>") ?? "";
  assert.ok(!/[<>]/.test(out), out);
  assert.ok(!/script/i.test(out), out);
});

test("nested wiki templates are removed, not rearranged into a new one", () => {
  assert.equal(nameOf("RLCS {{f{{x}}lag|de}} Split"), "RLCS Split");
});

test("no angle bracket reaches the page, balanced or not", () => {
  // An unclosed tag matches none of the markup rules, so the final sweep is
  // what catches it.
  for (const raw of ["RLCS <b 2026", "RLCS > 2026", "<img src=x onerror=alert(1)"]) {
    const out = nameOf(raw) ?? "";
    assert.ok(!out.includes("<"), `"<" survived in ${JSON.stringify(out)}`);
    assert.ok(!out.includes(">"), `">" survived in ${JSON.stringify(out)}`);
  }
});

test("ordinary names are untouched", () => {
  assert.equal(nameOf("RLCS 2026 World Championship"), "RLCS 2026 World Championship");
  // The hyphen rule runs after the strip and is the only edit a clean name gets.
  assert.equal(nameOf("RLCS 2026 - Major 3"), "RLCS 2026 Major 3");
  assert.equal(nameOf("[[RLCS 2026|RLCS 2026]] Finals"), "RLCS 2026 Finals");
});
