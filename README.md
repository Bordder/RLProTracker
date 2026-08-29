<h1 align="center">RL Pro Tracker</h1>

<p align="center">
  A dashboard for professional Rocket League players' ranked statistics and playtime.
</p>

<p align="center">
  <a href="https://github.com/Bordder/RLProTracker/actions/workflows/hourly.yml"><img src="https://github.com/Bordder/RLProTracker/actions/workflows/hourly.yml/badge.svg" alt="Hourly update"></a>
  <a href="https://github.com/Bordder/RLProTracker/actions/workflows/roster.yml"><img src="https://github.com/Bordder/RLProTracker/actions/workflows/roster.yml/badge.svg" alt="Roster refresh"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node 20+">
  <img src="https://img.shields.io/badge/dependencies-0-blue" alt="Zero dependencies">
</p>

## About

RL Pro Tracker collects publicly available Rocket League statistics for professional players and presents them by player and by team. It reports ranked playtime and ladder performance over rolling 24 hour, 7 day, and 14 day windows.

All data comes from public sources (Steam Web API, Liquipedia, and tracker.gg). The project stores only game statistics for the configured list of professional players. It does not collect data about site visitors.

## Features

- Ranked playtime per player over 24 hour, 7 day, and 14 day windows.
- Combined playtime and roster coverage per team.
- Ranked games played and rating per playlist (1v1, 2v2, 3v3). *(in progress)*
- Coverage for the full roster: public playtime where available, live status polling where a profile hides its game history, and estimates for fully private profiles.
- Fully automated collection through scheduled jobs, with a static frontend that always shows the latest data.

## How it works

The project has two halves that stay decoupled:

```
Data collection (scheduled)            Website (static)
  roster job  ->  player -> Steam ID     index.html
  hourly job  ->  stats  -> JSON   -->   reads the JSON at runtime
                                         renders player and team tables
```

Scheduled jobs write JSON into the repository. The website fetches that JSON at load time, so new data appears without rebuilding or redeploying the site.

## Tech stack

| Layer | Choice |
| --- | --- |
| Data scripts | Node.js, standard library only (no dependencies) |
| Frontend | Plain HTML, CSS, and JavaScript |
| Scheduling | GitHub Actions (cron) |
| Hosting | Any static host (Cloudflare Pages, GitHub Pages, Netlify, etc.) |

## Getting started

### Prerequisites

- Node.js version 20 or newer
- A free Steam Web API key from https://steamcommunity.com/dev/apikey

### 1. Clone the repository

```bash
git clone https://github.com/Bordder/RLProTracker.git
cd RLProTracker
```

There are no packages to install. The scripts use only the Node.js standard library.

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

The roster lives in `data/teams.json`. Each team lists its players by their Liquipedia page title:

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

If a player shows `no-steam-link`, their Liquipedia page has no linked Steam profile. Correct the page title, or add the Steam ID manually in `data/roster.json`.

### The data pipeline

Each script does one job and writes files the next one reads:

| Script | Reads | Writes |
| --- | --- | --- |
| `scripts/fetchRoster.mjs` | `data/teams.json` | `data/roster.json` |
| `scripts/fetchSteam.mjs` | `data/roster.json` | `data/snapshots/*.json` |
| `scripts/computeDeltas.mjs` | `data/snapshots/*` | `data/derived/steam-hours.json` |
| `scripts/aggregate.mjs` | `data/derived/steam-hours.json` | `data/derived/team-hours.json` |
| `scripts/pollPresence.mjs` | `data/roster.json` | `data/presence/log.jsonl` |
| `scripts/computePresenceHours.mjs` | `data/presence/log.jsonl` | `data/derived/presence-hours.json` |
| `scripts/buildSite.mjs` | `data/derived/*` | `web/data/`, `web/config.js` |

Rolling windows are built by comparing snapshots over time, so the 24 hour and 7 day figures fill in as history accumulates.

### Frontend

The site is a single `web/index.html` file with no build step. It reads the JSON in `data/derived` (locally) or from `window.__DATA_BASE__` (in production, set by `buildSite.mjs`). Edit the file directly and refresh.

## Deployment

1. Host the `web/` directory on any static host. Set the build command to `npm run build:site` and the output directory to `web`.
2. Set the environment variable `DATA_BASE` to the raw URL of the `data/derived` directory so the site reads fresh data without rebuilding.
3. The scheduled workflows in `.github/workflows` collect data automatically. Add `STEAM_API_KEY` as an encrypted repository secret so they can run.

## Data sources

| Data | Source |
| --- | --- |
| Rosters and Steam IDs | Liquipedia |
| Playtime | Steam Web API |
| Ranked games and rating | tracker.gg *(planned)* |

Please respect each source's terms of use and rate limits.

## License

Released under the MIT License. See [LICENSE](LICENSE).

---

<p align="center"><sub>Built with Claude Opus 4.8.</sub></p>
