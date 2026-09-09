// Status page.
//
// Deliberately reads the same published JSON the board reads, rather than any
// privileged health endpoint. A status page fed from a different source can sit
// there saying everything is fine while the thing visitors actually load is
// broken; this one cannot, because if the data is stale here it is stale there.
//
// The script is external because the CSP is script-src 'self' with no
// unsafe-inline. See scripts/buildSite.mjs.
(function () {
  "use strict";

  // Age thresholds per collector, in minutes. Each is a multiple of its own
  // cadence, so a single missed run never raises an alarm but a stopped
  // collector does.
  // `up` is the file holding that collector's own run history. Team aggregates
  // has none of its own and shares the tracker's, which is not a fudge: they
  // are written by the same pipeline in the same run, so their uptime is the
  // same number by construction.
  var FEEDS = [
    { file: "tracker.json", up: "uptime.json", name: "Ranked stats",
      sub: "MMR per playlist and games played", late: 8, bad: 30 },
    { file: "steam-hours.json", up: "uptime-steam.json", name: "Steam playtime",
      sub: "Total and two-week hours", late: 90, bad: 240 },
    { file: "presence-hours.json", up: "uptime-presence.json", name: "Presence poll",
      sub: "Estimates hours for players whose playtime is hidden", late: 20, bad: 75 },
    { file: "team-tracker.json", up: "uptime.json", name: "Team aggregates",
      sub: "Roster averages built from the ranked stats above", late: 10, bad: 40 }
  ];

  // 48 blocks of half an hour. Enough of them that a bad patch is a visible
  // run of colour rather than one fat block, and few enough to stay legible on
  // a phone.
  var SLOTS = 48, SLOT_MIN = 30;

  var $ = function (id) { return document.getElementById(id); };

  var getJson = function (path) {
    return fetch(path + "?t=" + Math.floor(Date.now() / 30000), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  };

  // Whole units only. "3 minutes" reads as a status; "3.4 minutes" reads as a
  // measurement and invites the reader to work out whether it is bad.
  var ageWords = function (ms) {
    if (ms == null) return "unknown";
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + " second" + (s === 1 ? "" : "s");
    var m = Math.round(s / 60);
    if (m < 60) return m + " minute" + (m === 1 ? "" : "s");
    var h = Math.round(m / 60);
    if (h < 24) return h + " hour" + (h === 1 ? "" : "s");
    var d = Math.round(h / 24);
    return d + " day" + (d === 1 ? "" : "s");
  };

  // One word per state, which is what a reader takes away. Statuspage-style
  // pages lead with this rather than a percentage for the same reason: the
  // word is the answer, the number is the evidence.
  var STATE_WORD = { ok: "Operational", late: "Delayed", bad: "Stalled" };

  var stateOf = function (ageMs, feed) {
    if (ageMs == null) return "bad";
    var min = ageMs / 60000;
    if (min >= feed.bad) return "bad";
    if (min >= feed.late) return "late";
    return "ok";
  };

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  var parseAt = function (o) {
    if (!o || !o.computedAt) return null;
    var t = Date.parse(o.computedAt);
    return isNaN(t) ? null : t;
  };

  var render = function (results) {
    var now = Date.now();
    var rows = [], hists = [];
    var worst = "ok";
    var reachable = 0;
    var newest = null;

    FEEDS.forEach(function (feed, i) {
      var at = parseAt(results[i]);
      var age = at == null ? null : now - at;
      var st = stateOf(age, feed);
      if (at != null) reachable++;
      if (i === 0) newest = age;
      if (st === "bad") worst = "bad";
      else if (st === "late" && worst === "ok") worst = "late";

      var hist = history(results[FEEDS.length + i], feed, now);
      hists.push(hist);

      rows.push(
        '<div class="col is-' + st + '">' +
          '<div class="col-head">' +
            '<div class="col-name"><i aria-hidden="true"></i><b>' + esc(feed.name) + "</b>" +
            "<span>" + esc(feed.sub) + "</span></div>" +
            '<span class="col-pct" title="' + esc(hist.explain) + '">' + hist.pctText + "</span>" +
            '<span class="col-age">' + (at == null ? "no reading" : esc(ageWords(age)) + " ago") + "</span>" +
            '<span class="col-state">' + STATE_WORD[st] + "</span>" +
          "</div>" +
          '<div class="bar" role="img" aria-label="' + esc(feed.name + ": " + hist.explain) + '">' +
          hist.cells + "</div>" +
        "</div>"
      );
    });

    $("cols").innerHTML = rows.join("") +
      '<div class="col foot"><div class="col-axis"><span>24 hours ago</span><span>now</span></div></div>';

    // The verdict is the worst state of any collector. That is only fair
    // because each threshold is scaled to its own cadence, so the slow hourly
    // feeds cannot trip the alarm just for being slow.
    var v = $("verdict");
    var title, sub;
    if (reachable === 0) {
      worst = "bad";
      title = "Cannot reach the data";
      sub = "The published files did not load. The site itself may be down.";
    } else if (worst === "ok") {
      title = "Everything is running";
      sub = "Everything is up to date.";
    } else if (worst === "late") {
      title = "Running behind";
      sub = "A collector has missed several runs. Numbers are still shown but may be old.";
    } else {
      title = "Something is not updating";
      sub = "A collector has stopped reporting. Treat the affected figures as out of date.";
    }
    v.className = "verdict is-" + (worst === "bad" ? "bad" : worst === "late" ? "late" : "ok");
    $("verdictTitle").textContent = title;
    $("verdictSub").textContent = sub;
    $("checked").textContent = "Checked " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + ".";

    // Coverage. Counts come from the same payloads, so they describe exactly
    // what the board is showing right now.
    var tracker = results[0], steam = results[1], teamT = results[3];
    var players = (tracker && tracker.players) || [];
    var ranked = players.filter(function (p) {
      return p.mmr && (p.mmr.ones != null || p.mmr.twos != null || p.mmr.threes != null);
    }).length;
    var sp = (steam && steam.players) || [];
    var withHours = sp.filter(function (p) { return p.totalHours != null; }).length;
    var teams = (teamT && teamT.teams) || [];

    // "94 / 94" is noise: the denominator only says something when the two
    // differ, which for ranked players means a profile we cannot read.
    var cov = [
      { k: "Players ranked", v: ranked, of: ranked === players.length ? null : players.length },
      { k: "Teams covered", v: teams.length, of: null },
      { k: "Playtime visible", v: withHours, of: sp.length }
    ];
    $("cov").innerHTML = cov.map(function (c) {
      return '<div><span class="k">' + esc(c.k) + '</span><span class="v">' + esc(c.v) +
        (c.of != null ? " <small>/ " + esc(c.of) + "</small>" : "") + "</span></div>";
    }).join("");

    summary(worst, reachable, newest, hists);
  };

  // Three figures under the verdict: the state now, when the board last moved,
  // and how the day went. The last one takes the WORST collector for each block
  // of the day, so a run of blocks counts as one interruption however many
  // collectors were caught in it - which is how a reader would count it.
  var summary = function (worst, reachable, newest, hists) {
    var blocks = [];
    for (var i = 0; i < SLOTS; i++) {
      var w = null;
      for (var h = 0; h < hists.length; h++) {
        var st = hists[h].states[i];
        if (st === "bad") w = "bad";
        else if (st === "late" && w !== "bad") w = "late";
        else if (st === "ok" && w == null) w = "ok";
      }
      blocks.push(w);
    }

    var known = 0, clean = 0, lost = 0, breaks = 0, inBreak = false;
    for (var j = 0; j < blocks.length; j++) {
      if (blocks[j] == null) { inBreak = false; continue; }
      known++;
      if (blocks[j] === "ok") { clean++; inBreak = false; }
      else {
        lost += SLOT_MIN;
        if (!inBreak) breaks++;
        inBreak = true;
      }
    }
    var pct = known ? Math.round((clean / known) * 1000) / 10 : null;

    var word = reachable === 0 ? "Down" : (worst === "ok" ? "Up" : worst === "late" ? "Delayed" : "Stalled");
    var wordSub = reachable === 0
      ? "The published data did not load."
      : (worst === "ok"
        ? "All four collectors reporting."
        : "One collector is behind. See the rows below.");

    var cards = [
      { cls: reachable === 0 ? "bad" : worst, k: "Current status", v: word, c: wordSub },
      { cls: "", k: "Newest numbers", v: newest == null ? "unknown" : ageWords(newest) + " ago",
        c: "Ranked stats, collected every 2 minutes." },
      { cls: pct == null ? "" : (pct >= 99 ? "ok" : pct >= 95 ? "late" : "bad"),
        k: "Last 24 hours", v: pct == null ? "&mdash;" : (pct === 100 ? "100%" : pct.toFixed(1) + "%"),
        // "behind" would read as how stale the data is now, which is the
        // card to the left. This is how much of the day was affected.
        c: breaks === 0 ? "No interruptions." :
          breaks + (breaks === 1 ? " interruption, " : " interruptions, ") + ageWords(lost * 60000) + " affected." }
    ];

    $("sum").innerHTML = cards.map(function (c) {
      return '<div class="sc' + (c.cls ? " is-" + c.cls : "") + '">' +
        '<span class="k">' + esc(c.k) + "</span>" +
        '<span class="v">' + c.v + "</span>" +
        '<span class="c">' + esc(c.c) + "</span></div>";
    }).join("");
  };

  // One collector's 24 hours, as 48 half-hour blocks.
  //
  // A block is judged by the longest gap between collections inside it, against
  // that collector's own thresholds. That one rule covers every cadence here -
  // two minutes for the tracker, an hour for Steam - where counting runs per
  // block cannot: half an hour of an hourly collector legitimately contains
  // either one run or none, and counting would call every other block an
  // outage.
  //
  // It also replaces a part-filled block, which two earlier attempts proved
  // unreadable: a bar height put every hour between 90 and 100% of the space,
  // and a flat threshold colour threw the variation away. A solid block per
  // half hour makes the count of bad blocks the signal.
  var history = function (up, feed, now) {
    var runs = (up && Array.isArray(up.runs)) ? up.runs.slice().sort(function (a, b) { return a - b; }) : [];
    var nowMin = Math.floor(now / 60000);
    // Snap the blocks to the half hour so a tooltip reads "14:00-14:30" rather
    // than "14:26-14:56". The last block is the half hour in progress.
    var start = Math.floor(nowMin / SLOT_MIN) * SLOT_MIN - (SLOTS - 1) * SLOT_MIN;
    var first = runs.length ? runs[0] : null;
    var cells = [], states = [], ok = 0, known = 0;

    for (var i = 0; i < SLOTS; i++) {
      var from = start + i * SLOT_MIN;
      var to = Math.min(from + SLOT_MIN, nowMin);

      // Nothing was being recorded yet: that is not an outage, and painting it
      // red would invent a failure that never happened.
      if (first == null || from + SLOT_MIN <= first) {
        cells.push('<span class="is-unknown" title="' + span(from) + ' · not recorded yet"></span>');
        states.push(null);
        continue;
      }

      // The gap that matters can start before this block, so seed it with the
      // last collection at or before it.
      var prev = null, n = 0;
      for (var j = 0; j < runs.length; j++) {
        if (runs[j] <= from) prev = runs[j];
        else if (runs[j] < to) { n++; }
      }
      var marks = [prev == null ? Math.max(from, first) : prev];
      for (var k = 0; k < runs.length; k++) if (runs[k] > from && runs[k] < to) marks.push(runs[k]);
      marks.push(to);

      var gap = 0;
      for (var m = 1; m < marks.length; m++) gap = Math.max(gap, marks[m] - marks[m - 1]);

      var st = gap <= feed.late ? "ok" : (gap <= feed.bad ? "late" : "bad");
      states.push(st);
      known++;
      if (st === "ok") ok++;
      // Plain words, not pipeline vocabulary. A reader hovering a block wants
      // the half hour it covers and whether it was fine, not a count of
      // collections and a gap in minutes.
      var says = st === "ok" ? "on time"
        : (st === "late" ? "slow" : "missed") + ", " + ageWords(gap * 60000) + " between updates";
      cells.push('<span class="is-' + st + '" title="' + span(from) + " · " + says + '"></span>');
    }

    var pct = known ? Math.round((ok / known) * 1000) / 10 : null;
    return {
      states: states,
      cells: cells.join(""),
      pctText: pct == null ? "&mdash;" : (pct === 100 ? "100%" : pct.toFixed(1) + "%"),
      explain: known === 0
        ? "No history recorded yet."
        : pct + "% of the last " + (known === SLOTS ? "24 hours" : Math.round(known * SLOT_MIN / 60) + " hours") +
          " went by with no gap longer than " + feed.late + " minutes."
    };
  };

  var clock = function (min) {
    return new Date(min * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // The half hour a block stands for, named at both ends: "14:00-14:30" is
  // obviously a period, where a single time reads as an instant.
  var span = function (from) {
    return clock(from) + "–" + clock(from + SLOT_MIN);
  };

  var loading = false;
  var refresh = function () {
    if (loading) return;
    loading = true;
    // Feeds first, then each one's history, so render() can index straight
    // into the second half with FEEDS.length + i.
    Promise.all(
      FEEDS.map(function (f) { return getJson("/data/" + f.file); })
        .concat(FEEDS.map(function (f) { return getJson("/data/" + f.up); }))
    )
      .then(function (all) { render(all); })
      .catch(function () {})
      .then(function () { loading = false; });
  };

  refresh();
  setInterval(refresh, 30000);
  // Same reason as the board: setInterval is throttled to near nothing in a
  // background tab, so a status page left open would otherwise show a reading
  // from whenever the reader last looked at it.
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  window.addEventListener("pageshow", function (e) { if (e.persisted) refresh(); });
  window.addEventListener("online", refresh);

  var yr = document.getElementById("yr");
  if (yr) yr.textContent = String(new Date().getFullYear());
})();
