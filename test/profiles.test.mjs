// Nationality and Twitch channel, read off a Liquipedia player page.
//
// Both fields come from a wiki, so both are attacker-controlled. Neither is
// escaped on the way through; both are allowlisted, which is the stronger
// property, and these tests are what hold the allowlists shut.
//
// Every fixture string below is real, taken from the live roster on
// 16 September 2026, because the cases that matter here were all discovered by
// looking at the actual pages rather than by imagining what a page might hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { twitchFromLinks, countryFromWikitext, profileFrom, looksWrongPerson } from "../scripts/profiles.mjs";
import { codeOf, countryOf, flagOf, labelOf } from "../scripts/countries.mjs";

const links = (...urls) => urls.map((url) => ({ url }));

test("a clip is not a channel", () => {
  // Vatira's page carries three twitch.tv URLs and only one is the channel.
  // Taking the first match would have published a clip permalink.
  assert.equal(
    twitchFromLinks(links(
      "https://www.twitch.tv/vatira_/clip/TubularShortKumquatPupper-3AA6owqg6mRcWswF",
      "https://clips.twitch.tv/AcceptableTalentedLegBabyRage-HDvwrfBma6TktLyh",
      "https://www.twitch.tv/vatira_",
    )),
    "vatira_",
  );
});

test("a clip with a query string is still not a channel", () => {
  // ExoTiiK's page, where the clip URL carries ?filter=clips&range=7d&sort=time.
  assert.equal(
    twitchFromLinks(links("https://www.twitch.tv/exotiikrl/clip/CorrectSpotlessTardigradeTakeNRG-gBpAqkeswIQP6xuR?filter=clips&range=7d&sort=time")),
    null,
  );
});

test("case is preserved, because a channel is shown as well as linked", () => {
  assert.equal(twitchFromLinks(links("https://www.twitch.tv/TorsosRL")), "TorsosRL");
});

test("Twitch's own pages are not channels", () => {
  for (const u of ["https://www.twitch.tv/directory", "https://www.twitch.tv/videos", "https://www.twitch.tv/p"]) {
    assert.equal(twitchFromLinks(links(u)), null, u);
  }
});

test("nothing that is not a twitch.tv channel gets through", () => {
  const bad = [
    "https://twitch.tv.evil.example/hacker",     // suffix, not the host
    "https://m.twitch.tv/somebody",              // a host this does not accept
    "javascript:alert(1)",                        // not a URL with a host at all
    "https://www.twitch.tv/has a space",
    "https://www.twitch.tv/ab",                   // under Twitch's 3-char minimum
    "https://www.twitch.tv/" + "a".repeat(26),    // over its 25-char maximum
    "https://www.twitch.tv/name%2F..%2Fevil",
    "not a url",
  ];
  for (const u of bad) assert.equal(twitchFromLinks(links(u)), null, u);
  assert.equal(twitchFromLinks(null), null);
  assert.equal(twitchFromLinks([]), null);
});

test("the primary country is the specific one, not the United Kingdom", () => {
  // Liquipedia writes an English player as country=England with country2=United
  // Kingdom. Reading country2, or sorting the page's categories, would put a
  // Union Jack on five players who are listed as English.
  const { country, country2 } = countryFromWikitext("|name=Archie\n|country=England\n|country2=United Kingdom\n");
  assert.equal(country, "England");
  assert.equal(country2, "United Kingdom");
});

test("a genuinely dual national keeps the country Liquipedia lists first", () => {
  // Atomic: United States, then Venezuela. 25 of 104 players carry a second
  // country, so which one wins is not an edge case.
  assert.equal(countryFromWikitext("|name=Massimo Franceschi\n|country=United States\n|country2=Venezuela\n").country, "United States");
});

test("a country named inside another template is not the player's own", () => {
  // Only a top-level parameter counts. The brace exclusion is what stops a flag
  // template elsewhere on the page from being read as the infobox field.
  assert.equal(countryFromWikitext("|team={{Team|country=Germany}}\n|country=France\n").country, "France");
});

test("no country field, or no page, reads as nothing rather than throwing", () => {
  assert.deepEqual(countryFromWikitext(""), { country: null, country2: null });
  assert.deepEqual(countryFromWikitext(null), { country: null, country2: null });
  assert.deepEqual(countryFromWikitext("|name=Somebody\n"), { country: null, country2: null });
});

test("an unknown country name yields no flag and says so", () => {
  // The point of the allowlist: a name this build does not know produces null,
  // never a guess, and `unmapped` is what makes the omission visible in the log.
  assert.equal(codeOf("Wakanda"), null);
  assert.equal(countryOf("Wakanda"), null);
  const p = profileFrom({ revisions: [{ slots: { main: { content: "|country=Wakanda\n" } } }] });
  assert.equal(p.country, null);
  assert.deepEqual(p.unmapped, ["Wakanda"]);
});

test("a known country name yields the flag and the code", () => {
  assert.deepEqual(countryOf("France"), { name: "France", code: "FR", flag: "\u{1F1EB}\u{1F1F7}", label: "FR" });
  // Every country name on the live roster resolves. A regression here is a
  // player silently losing their flag.
  for (const n of ["United States", "Saudi Arabia", "Brazil", "Australia", "France", "Spain",
    "South Africa", "Netherlands", "Denmark", "Italy", "Morocco", "Canada", "Germany",
    "Belgium", "Poland", "Mexico", "Chile", "Thailand", "Malaysia", "Argentina", "Kuwait",
    "Croatia", "Austria", "New Zealand", "England", "Scotland"]) {
    assert.ok(codeOf(n), `${n} has no code`);
    assert.ok(flagOf(codeOf(n)), `${n} has no flag`);
  }
});

test("a UK nation gets a tag sequence and a label of its own", () => {
  // The letter-pair fallback shows the code, and "gbeng" is not two letters, so
  // a subdivision has to supply the label separately or it would fall back to
  // nothing at all.
  const eng = countryOf("England");
  assert.equal(eng.code, "gbeng");
  assert.equal(eng.label, "ENG");
  assert.equal(eng.flag, "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}");
  assert.equal(labelOf("FR"), "FR");
});

test("flagOf refuses anything that is not a code", () => {
  for (const c of [null, "", "F", "FRA", "fr", "<b>", "12"]) assert.equal(flagOf(c), null, JSON.stringify(c));
});

test("a page is read end to end", () => {
  // Scrub Killa, as the API actually returns him.
  const p = profileFrom({
    revisions: [{ slots: { main: { content: "{{Infobox player\n|name=Kyle Robertson\n|country=Scotland\n|country2=United Kingdom\n}}" } } }],
    extlinks: links(
      "https://www.twitch.tv/scrubkillaa_/clip/NiceBillowingBoarPanicBasket-SpqprtebZx9mkD-e",
      "https://www.twitch.tv/scrubkillaa_",
    ),
  });
  assert.equal(p.country.code, "gbsct");
  assert.equal(p.country.label, "SCO");
  // Scotland AND the United Kingdom is one nationality written in two fields.
  assert.equal(p.country2, null);
  assert.equal(p.twitch, "scrubkillaa_");
  assert.deepEqual(p.unmapped, []);
});

test("a missing page produces a profile of nulls, not an exception", () => {
  const p = profileFrom({ missing: true });
  assert.deepEqual({ c: p.country, c2: p.country2, t: p.twitch, u: p.unmapped }, { c: null, c2: null, t: null, u: [] });
  const q = profileFrom(undefined);
  assert.deepEqual({ c: q.country, t: q.twitch }, { c: null, t: null });
});

test("a genuine second nationality is kept, in the order the page lists it", () => {
  // diaz. His page reads United States with Mexico under it, and the panel named
  // only the first until this was added. 19 of 104 players are in this position.
  const p = profileFrom({ revisions: [{ slots: { main: { content: "|country=United States\n|country2=Mexico\n" } } }] });
  assert.equal(p.country.code, "US");
  assert.equal(p.country2.code, "MX");
});

test("a UK nation's parent state is not a second nationality", () => {
  // All four subdivisions, because Liquipedia writes every one of them this way
  // and "England and the United Kingdom" says nothing the first half did not.
  for (const n of ["England", "Scotland", "Wales", "Northern Ireland"]) {
    const p = profileFrom({ revisions: [{ slots: { main: { content: `|country=${n}\n|country2=United Kingdom\n` } } }] });
    assert.ok(p.country, n);
    assert.equal(p.country2, null, n);
  }
  // The UK beside a country that is NOT one of its nations is a real second
  // nationality, and Fever on the live roster is exactly that case.
  const fever = profileFrom({ revisions: [{ slots: { main: { content: "|country=Australia\n|country2=United Kingdom\n" } } }] });
  assert.equal(fever.country.code, "AU");
  assert.equal(fever.country2.code, "GB");
});

test("an unknown name in either field is reported, and neither blocks the other", () => {
  const p = profileFrom({ revisions: [{ slots: { main: { content: "|country=France\n|country2=Wakanda\n" } } }] });
  assert.equal(p.country.code, "FR");
  assert.equal(p.country2, null);
  assert.deepEqual(p.unmapped, ["Wakanda"]);
});

test("a page that is not about a player is reported", () => {
  // The real "Juicy" page: a Dutch caster, which is what the Karmine Corp
  // player's own name resolves to. Nothing about reading it fails - it has an
  // infobox, a nationality and a Twitch channel, all belonging to somebody
  // else - so the only defence is noticing the page is not a player's.
  const caster = {
    title: "Juicy",
    categories: [{ title: "Category:Dutch Casters" }, { title: "Category:Casters" }],
    revisions: [{ slots: { main: { content: "|id=Juicy\n|name=Joessi Moorman\n|country=Netherlands\n|roles=Caster\n" } } }],
  };
  const w = looksWrongPerson(caster);
  assert.ok(w, "the caster page was not flagged");
  assert.equal(w.role, "Caster");
  assert.ok(w.categories.includes("Casters"));
});

test("an ordinary player page is not reported", () => {
  const player = {
    title: "Vatira",
    categories: [{ title: "Category:French Players" }, { title: "Category:Players" }],
    revisions: [{ slots: { main: { content: "|country=France\n" } } }],
  };
  assert.equal(looksWrongPerson(player), null);
  // A page whose categories were not fetched cannot be judged, and guessing
  // would flag the whole roster.
  assert.equal(looksWrongPerson({ title: "X", revisions: [] }), null);
  assert.equal(looksWrongPerson(undefined), null);
});
