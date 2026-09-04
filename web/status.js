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
  var FEEDS = [
    { file: "tracker.json", name: "Ranked stats",
      sub: "MMR per playlist and games played", late: 8, bad: 30 },
    { file: "steam-hours.json", name: "Steam playtime",
      sub: "Total and two-week hours", late: 90, bad: 240 },
    { file: "presence-hours.json", name: "Presence poll",
      sub: "Estimates hours for players whose playtime is hidden", late: 20, bad: 75 },
    { file: "team-tracker.json", name: "Team aggregates",
      sub: "Roster averages built from the ranked stats above", late: 10, bad: 40 }
  ];

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
    var rows = [];
    var worst = "ok";
    var reachable = 0;

    FEEDS.forEach(function (feed, i) {
      var at = parseAt(results[i]);
      var age = at == null ? null : now - at;
      var st = stateOf(age, feed);
      if (at != null) reachable++;
      if (st === "bad") worst = "bad";
      else if (st === "late" && worst === "ok") worst = "late";

      var when = at == null ? "no reading" : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      var label = st === "ok" ? "Healthy" : (st === "late" ? "Behind" : "Not updating");

      rows.push(
        '<tr><td><span class="nm">' + esc(feed.name) + '</span>' +
        '<span class="sub">' + esc(feed.sub) + "</span></td>" +
        '<td><span class="num">' + esc(when) + "</span>" +
        '<span class="sub">' + esc(ageWords(age)) + " ago</span></td>" +
        '<td class="r"><span class="state is-' + st + '"><i aria-hidden="true"></i>' + label + "</span></td></tr>"
      );
    });

    $("rows").innerHTML = rows.join("");

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
      sub = "A collector has missed several runs. Numbers are still shown but may be a little old.";
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

    var cov = [
      { k: "Players ranked", v: ranked, of: players.length },
      { k: "Teams covered", v: teams.length, of: null },
      { k: "Playtime visible", v: withHours, of: sp.length },
      { k: "Snapshots held", v: (tracker && tracker.snapshotCount) || 0, of: null }
    ];
    $("cov").innerHTML = cov.map(function (c) {
      return '<div><span class="k">' + esc(c.k) + '</span><span class="v">' + esc(c.v) +
        (c.of != null ? " <small>/ " + esc(c.of) + "</small>" : "") + "</span></div>";
    }).join("");
  };

  // Expected collections per hour. Kept next to the cadence it mirrors: if the
  // cron moves, this has to move with it or the strip reports a false outage.
  var RUNS_PER_HOUR = 30;

  var renderHistory = function (up) {
    var strip = $("strip"), legend = $("legend"), hist = $("hist");
    if (!strip) return;

    var runs = (up && Array.isArray(up.runs)) ? up.runs.slice().sort(function (a, b) { return a - b; }) : [];
    if (!runs.length) {
      strip.innerHTML = "";
      legend.textContent = "No history recorded yet. This fills in as the collector runs.";
      hist.innerHTML = "";
      return;
    }

    var nowMin = Math.floor(Date.now() / 60000);
    var start = nowMin - 24 * 60;
    var firstKnown = runs[0];

    var cells = [], known = 0, got = 0;
    for (var h = 0; h < 24; h++) {
      var from = start + h * 60, to = from + 60;
      // An hour that ended before anything was ever recorded is unknown, not an
      // outage. Painting it red would invent a failure that never happened.
      if (to <= firstKnown) {
        cells.push('<span class="is-unknown" title="' + hourLabel(from) + ': not recorded"></span>');
        continue;
      }
      var n = 0;
      for (var i = 0; i < runs.length; i++) if (runs[i] >= from && runs[i] < to) n++;
      // Expect collections only for the part of this hour we were actually
      // recording: the current hour is not finished, and the first hour began
      // before the records did. Charging a full hour against either one
      // invents misses that never happened - on a cold start that read as
      // "3.3% landed" directly under a verdict of everything running.
      var covFrom = Math.max(from, firstKnown);
      var covTo = Math.min(to, nowMin);
      var elapsed = Math.max(1, covTo - covFrom);
      var expect = Math.max(1, Math.round(RUNS_PER_HOUR * (elapsed / 60)));
      var ratio = Math.min(1, n / expect);
      known += expect; got += Math.min(n, expect);
      var st = ratio >= 0.8 ? "ok" : (ratio >= 0.4 ? "late" : "bad");
      // The bite is the share that did not land, on a scale where losing a
      // third of the hour fills the block. Anything worse is already red.
      var miss = Math.min(100, Math.round(((1 - ratio) / 0.34) * 100));
      cells.push('<span class="is-' + st + '" style="--miss:' + miss + '%" title="' +
        hourLabel(from) + ": " + n + " of ~" + expect + ' collections"></span>');
    }
    strip.innerHTML = cells.join("");

    var pct = known ? Math.round((got / known) * 1000) / 10 : null;

    // Longest gap between consecutive collections, which is what a reader
    // actually felt: the longest the board went without moving.
    var gap = 0;
    for (var j = 1; j < runs.length; j++) gap = Math.max(gap, runs[j] - runs[j - 1]);

    var hours = Math.min(24, Math.max(1, Math.round((nowMin - firstKnown) / 60)));
    legend.textContent = "One block per hour; the dark part is what did not land. Amber slipped, red lost most of the hour." +
      (firstKnown > start ? " Hatched hours are before records began." : "");
    hist.innerHTML =
      '<div><span class="k">Collections landed</span><span class="v">' + (pct == null ? "&mdash;" : pct + "<small>%</small>") + "</span></div>" +
      '<div><span class="k">Longest gap</span><span class="v">' + ageWords(gap * 60000) + "</span></div>" +
      '<div><span class="k">Runs recorded</span><span class="v">' + runs.length + "</span></div>" +
      '<div><span class="k">History covers</span><span class="v">' + hours + "<small>h</small></span></div>";
  };

  var hourLabel = function (min) {
    return new Date(min * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  var loading = false;
  var refresh = function () {
    if (loading) return;
    loading = true;
    Promise.all(FEEDS.map(function (f) { return getJson("/data/" + f.file); })
      .concat([getJson("/data/uptime.json")]))
      .then(function (all) {
        render(all);
        renderHistory(all[FEEDS.length]);
      })
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
