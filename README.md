<h1 align="center">RL Pro Tracker</h1>

<p align="center">
  A dashboard for professional Rocket League players' ranked statistics and playtime.
</p>

<p align="center">
  <a href="https://github.com/Bordder/RLProTracker/actions/workflows/tracker.yml"><img src="https://github.com/Bordder/RLProTracker/actions/workflows/tracker.yml/badge.svg" alt="Tracker update"></a>
  <a href="https://github.com/Bordder/RLProTracker/actions/workflows/steam.yml"><img src="https://github.com/Bordder/RLProTracker/actions/workflows/steam.yml/badge.svg" alt="Steam update"></a>
  <a href="https://github.com/Bordder/RLProTracker/actions/workflows/roster.yml"><img src="https://github.com/Bordder/RLProTracker/actions/workflows/roster.yml/badge.svg" alt="Roster refresh"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520%20%7C%20CI%2024-339933?logo=node.js&logoColor=white" alt="Node 20 or newer, CI runs Node 24">
  <a href="https://198x.online"><img src="https://img.shields.io/website?url=https%3A%2F%2F198x.online&up_message=live&up_color=FF5A1F&down_message=down&label=198x.online" alt="198x.online"></a>
</p>

## About

RL Pro Tracker collects publicly available Rocket League statistics for professional players and presents them by player and by team. It reports ranked playtime and ladder performance over rolling 24 hour, 7 day, and 2 week windows.

All data comes from public sources (Steam Web API, Liquipedia, and tracker.gg). The project stores only game statistics for the configured list of professional players. It does not collect data about site visitors.

> [!WARNING]
> **In development, and not finished.** The site is live and collecting real data, but it is
> actively being built: numbers can be wrong or missing, features move around, and things
> occasionally break without warning. Playtime for players who hide their Steam details is
> *estimated by sampling* and always undercounts - it is not a measurement. Treat everything
> here as an indication rather than a record.

## Features

- Ranked playtime per player over 24 hour, 7 day, and 2 week windows.
- Per team: total playtime across the roster, and how many of its players we can actually track.
- Each player's ranked games and MMR, broken down by playlist (1v1, 2v2, 3v3).
- Coverage for the full roster: public playtime where available, live status polling where a profile hides its game history, and estimates for fully private profiles.
- Fully automated collection through scheduled jobs, with a static frontend that always shows the latest data.

## How it works

The project has two halves that stay decoupled:

```
Data collection (scheduled)              Website (static)
roster job  (daily)  -> Steam IDs        index.html + rlpt.js
steam job   (hourly) -> playtime  -->    read the JSON at runtime
tracker job (3 min)  -> MMR + games      render player and team tables
presence    (5 min)  -> live in-game
```

Scheduled jobs write JSON into the repository. The website fetches that JSON at load time, so new data appears without rebuilding or redeploying the site.

GitHub drops most high-frequency scheduled runs on public repositories, so the collectors are
driven by a Cloudflare Worker (`worker/`) that calls the `workflow_dispatch` API every few
minutes. The crons inside each workflow are a slow safety net rather than the real cadence.

## Tech stack

| Layer | Choice |
| --- | --- |
| Data scripts | Node.js, standard library only (no dependencies) |
| Frontend | Plain HTML, CSS, and JavaScript |
| Scheduling | GitHub Actions, dispatched by a Cloudflare Worker cron |
| Hosting | Cloudflare Pages, with Pages Functions serving the data and the feedback endpoint |

## Getting started

### Prerequisites

- Node.js version 20 or newer (the workflows run Node 24, which is what CI verifies)
- A free Steam Web API key from https://steamcommunity.com/dev/apikey

### 1. Clone the repository

```bash
git clone https://github.com/Bordder/RLProTracker.git
cd RLProTracker
```

Nothing to install here: the scripts run on Node's standard library alone.

### 2. Provide your Steam API key

Get a free key at https://steamcommunity.com/dev/apikey (any domain works when registering).

macOS and Linux:

```bash
export STEAM_API_KEY=your_key_here
```

Windows (PowerShell):

```powershell
$env:STEAM_API_KEY="your_key_here"
```

### 3. Run the pipeline

```bash
npm run fetch:roster   # resolve each player to a Steam ID (writes data/roster.json)
npm run update         # collect playtime, compute windows, aggregate teams
npm run build:site     # copy data into web/ for serving
node scripts/serve.mjs # open http://localhost:5173
```

You now have the site running locally against real data.

## Working on the project

### Add or change tracked players

Teams and rosters live in `data/teams.json`, with each player listed by their Liquipedia page title:

```json
{
  "name": "Team Name",
  "stage": "group",
  "players": ["PlayerOne", "PlayerTwo", "PlayerThree"]
}
```

After editing, resolve the new players and refresh the data:

```bash
npm run fetch:roster
npm run update
```

Seeing `no-steam-link` for a player means their Liquipedia page has no Steam profile linked. Either fix the page title, or just add the Steam ID by hand in `data/roster.json`.

### The data pipeline

Each script does one job and writes files the next one reads:

| Script | Reads | Writes |
| --- | --- | --- |
| `scripts/fetchRoster.mjs` | `data/teams.json` | `data/roster.json` |
| `scripts/fetchSteam.mjs` | `data/roster.json` | `data/snapshots/*.json` |
| `scripts/computeDeltas.mjs` | `data/snapshots/*` | `data/derived/steam-hours.json` |
| `scripts/aggregate.mjs` | `data/derived/steam-hours.json` | `data/derived/team-hours.json` |
| `scripts/fetchTracker.mjs` | `data/roster.json`, `data/priorities.json` | `data/tracker-snapshots/*.json` |
| `scripts/computeTrackerDeltas.mjs` | `data/tracker-snapshots/*` | `data/derived/tracker.json` |
| `scripts/aggregateTracker.mjs` | `data/derived/tracker.json` | `data/derived/team-tracker.json` |
| `scripts/pollPresence.mjs` | `data/roster.json` | `data/presence/log.jsonl` |
| `scripts/computePresenceHours.mjs` | `data/presence/log.jsonl` | `data/derived/presence-hours.json` |
| `scripts/buildSite.mjs` | `data/derived/*` | `web/data/`, `web/config.js` |

Rolling windows are built by comparing snapshots over time, so the 24 hour and 7 day figures fill in as history accumulates.

### Tuning tracker update frequency

`data/priorities.json` controls how often each player's MMR and games are refreshed. A player id
maps to a target interval in hours, and `perRun` caps how many players a single run scrapes.

Every player currently sits on the same short interval, because reading the stats API directly
rather than loading profile pages cut a full-roster run to roughly 2 MB - cheap enough that
staggering is no longer worth the staleness it costs.

### Proxies

`fetchTracker.mjs` reads tracker.gg through rotating proxies, configured entirely by environment
variables so no credential is ever in the repository. Either form works, and `parseProxies()`
accepts both:

```
PROXY_LIST   one per line or comma separated: host:port:user:pass, host:port, or
             http://user:pass@host:port
PROXY_HOST   single host, with PROXY_PORTS as a comma separated list of ports and
   + PORTS   PROXY_USER / PROXY_PASS for credentials
```

Every proxy gets its own browser context, so each keeps a separate Cloudflare clearance cookie,
and work is rotated across all of them. Each attempt for a player uses a different proxy, so one
dead tunnel costs a retry rather than the player.

Set only one of the two forms. `parseProxies()` concatenates whatever it finds, so leaving stale
values in the other form quietly puts dead proxies back into the rotation.

### Frontend

`web/index.html` holds the markup and styles, `web/rlpt.js` the behaviour. No build step and no
framework. Data is fetched from `/data/<file>.json`, which a Pages Function proxies from the
repository with a short edge cache; `scripts/serve.mjs` mirrors that route locally, so the same
paths work in both places. Edit and refresh.

## Deployment

1. Deploy `web/` to Cloudflare Pages with build command `npm run build:site` and output
   directory `web`. `functions/` is picked up automatically and provides `/data/*` and
   `/feedback`.
2. Add `STEAM_API_KEY` as an encrypted repository secret so the workflows can collect data, and
   `GH_TOKEN` (a fine-grained token with Actions and Issues write) as a Pages secret so the
   Worker can dispatch jobs and the feedback form can file issues.
3. `npm run build:site` also generates `web/_headers`, which carries the content security policy
   and cache rules.

Another static host will serve the site, but `/data/*` and `/feedback` are Pages Functions and
would need replacing.

## Data sources

| Data | Source |
| --- | --- |
| Rosters and Steam IDs | Liquipedia |
| Playtime | Steam Web API |
| Ranked games and rating | tracker.gg |

Please respect each source's terms of use and rate limits.

## License

Released under the MIT License. See [LICENSE](LICENSE).

---

<p align="center"><sub>Built with Claude Opus 5.</sub></p>
