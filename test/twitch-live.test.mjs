// The live-status endpoint's pure parts.
//
// The property worth protecting here is not the parsing, it is WHERE THE
// CHANNEL LIST COMES FROM. It is built from this site's own player feed and
// never from the request, because an endpoint that will ask Twitch about any
// channel a caller names is an open proxy running on our client id, and that is
// the kind of use the Developer Services Agreement suspends an app's access
// for. channelsFrom is the whole of that boundary, so it is tested hardest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelsFrom, chunk, liveFrom } from "../functions/twitch-live.js";

const feed = (...twitch) => ({ players: twitch.map((t, i) => ({ id: "p" + i, twitch: t })) });

test("channels come from the feed, folded and deduplicated", () => {
  // The roster stores a channel as the player writes it; Twitch logins are
  // lowercase, and the response is matched against these.
  assert.deepEqual(channelsFrom(feed("TorsosRL", "vatira_", "torsosrl")), ["torsosrl", "vatira_"]);
});

test("a player with no channel contributes none", () => {
  assert.deepEqual(channelsFrom(feed(null, undefined, "", "vatira_")), ["vatira_"]);
  assert.deepEqual(channelsFrom({ players: [] }), []);
  assert.deepEqual(channelsFrom(null), []);
  assert.deepEqual(channelsFrom({}), []);
});

test("nothing that is not a Twitch login reaches the upstream URL", () => {
  // Same allowlist the collector and the page apply. A feed that had been
  // tampered with cannot inject a parameter, a path or a second channel.
  const bad = [
    "has space", "ab", "a".repeat(26), "name&user_login=someoneelse",
    "../../helix/users", "user?x=1", "user#frag", "<script>", "chan/sub", "%2F",
  ];
  assert.deepEqual(channelsFrom(feed(...bad)), []);
});

test("chunking keeps every request inside Twitch's 100-login limit", () => {
  const logins = Array.from({ length: 237 }, (_, i) => "chan" + i);
  const groups = chunk(logins);
  assert.deepEqual(groups.map((g) => g.length), [100, 100, 37]);
  // Nothing dropped and nothing duplicated across the split.
  assert.deepEqual(groups.flat(), logins);
  assert.deepEqual(chunk([]), []);
});

test("a stream becomes only what a badge needs", () => {
  // The badge only asks whether a channel is live. Viewer counts and start
  // times are not shown anywhere, so they are not republished either.
  const live = liveFrom([
    { user_login: "vatira_", game_name: "Rocket League", viewer_count: 1200, started_at: "2026-09-16T12:00:00Z", type: "live" },
  ]);
  assert.deepEqual(live, {
    vatira_: { game: "Rocket League" },
  });
});

test("the stream title is never carried", () => {
  // It is arbitrary text the streamer controls and would be the only free-form
  // string on the board. A badge does not need it, so it is not published and
  // there is nothing to escape.
  const live = liveFrom([
    { user_login: "x_y_z", title: "<img src=x onerror=alert(1)>", game_name: "Rocket League", viewer_count: 1, type: "live" },
  ]);
  assert.deepEqual(Object.keys(live.x_y_z).sort(), ["game"]);
  assert.ok(!JSON.stringify(live).includes("onerror"), JSON.stringify(live));
});

test("a rerun is not live", () => {
  // Twitch returns reruns from the same endpoint, and a rerun is exactly the
  // case where a badge would be a lie.
  assert.deepEqual(liveFrom([{ user_login: "a_b_c", type: "rerun", game_name: "Rocket League" }]), {});
});

test("only Rocket League counts as live", () => {
  // The board is about Rocket League, so a pro streaming something else is not
  // doing the thing a badge would be claiming. Filtered in the endpoint, which
  // also keeps what somebody plays on their own time out of the response.
  const streams = [
    { user_login: "a_b_c", game_name: "Just Chatting", viewer_count: 4, type: "live" },
    { user_login: "d_e_f", game_name: "Rocket League", viewer_count: 9, type: "live" },
  ];
  const live = liveFrom(streams, "Rocket League");
  assert.deepEqual(Object.keys(live), ["d_e_f"]);
  // The non-Rocket-League stream leaves no trace at all, not even the login.
  assert.ok(!JSON.stringify(live).includes("a_b_c"), JSON.stringify(live));
  assert.ok(!JSON.stringify(live).includes("Just Chatting"), JSON.stringify(live));
});

test("the game filter is case and whitespace tolerant", () => {
  // Twitch's category name is what it is, but a comparison that breaks on
  // casing would silently empty the board rather than fail loudly.
  const live = liveFrom([{ user_login: "a_b_c", game_name: " rocket league ", type: "live" }], "Rocket League");
  assert.deepEqual(Object.keys(live), ["a_b_c"]);
});

test("without a filter every game is reported", () => {
  const live = liveFrom([{ user_login: "a_b_c", game_name: "Just Chatting", type: "live" }]);
  assert.equal(live.a_b_c.game, "Just Chatting");
});

test("missing or odd fields do not throw and do not invent numbers", () => {
  const live = liveFrom([{ user_login: "a_b_c" }]);
  assert.deepEqual(live.a_b_c, { game: null });
  const weird = liveFrom([{ user_login: "d_e_f", game_name: 42, viewer_count: "lots", started_at: {} }]);
  assert.deepEqual(weird.d_e_f, { game: null });
  assert.deepEqual(liveFrom([]), {});
  assert.deepEqual(liveFrom(null), {});
  assert.deepEqual(liveFrom([null, undefined, {}]), {});
});
