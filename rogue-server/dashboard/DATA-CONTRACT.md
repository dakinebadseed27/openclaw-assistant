# Rogue Server Dashboard - Data Contract

The dashboard is a static page. All content comes from JSON files in `data/`, polled every 60 seconds
with `fetch("./data/<file>.json?t=<ms>", {cache: "no-store"})`. If a file fails to load or parse, the panel keeps its
last good data and shows a small amber "DATA ERR" tag in the panel title. Every file carries `"_note": "SAMPLE DATA"`
while it holds sample content; a real job should drop that field (and set `meta.sample` to `false`).
Text is always inserted with `textContent` (no HTML is interpreted).

## meta.json
Purpose: freshness, reload trigger, and the SAMPLE DATA badge.

| field | type | notes |
|---|---|---|
| last_updated | string, ISO 8601 with offset | Shown in header. Turns amber when older than 2 hours. |
| version | string | If it differs from the version loaded at page start, the page reloads itself. |
| sample | boolean | `true` shows the SAMPLE DATA badge. |

```json
{ "last_updated": "2026-10-30T12:00:00-10:00", "version": "2026.10.30-1", "sample": false }
```

## directives.json
Purpose: Today's Directives (short priority list, shown in order; about 5 fit at 1080p).

| field | type | notes |
|---|---|---|
| directives[] | array | |
| directives[].priority | "high" / "med" / "low" | Dot colour: amber / cyan / grey. |
| directives[].text | string | Keep under about 70 characters. |

```json
{ "directives": [ { "priority": "high", "text": "Send revised counter-offer on Kahala Ave listing" } ] }
```

## calendar.json
Purpose: Today's Calendar. Shown regardless of date; the server job should write only today's events.

| field | type | notes |
|---|---|---|
| events[] | array | Sort ascending by time (page does not sort). |
| events[].time | string "HH:MM" 24-hour | Displayed as 12-hour. Past events dim; the next one turns amber. |
| events[].title | string | |

```json
{ "events": [ { "time": "13:30", "title": "Walkthrough - Kakaako condo" } ] }
```

## vitals.json
Purpose: big-number tiles. The first 4 tiles are shown.

| field | type | notes |
|---|---|---|
| tiles[].label | string | e.g. "Active Listings" |
| tiles[].value | number or string | Shown large. |
| tiles[].sub | string, optional | Small caption. |

```json
{ "tiles": [ { "label": "Active Listings", "value": 12, "sub": "+2 this week" } ] }
```

## skills.json
Purpose: skill buttons. Tapping shows a "Coming soon" toast (no action yet).

| field | type | notes |
|---|---|---|
| skills[].id | string | Stable identifier for future wiring. |
| skills[].label | string | Button title. |
| skills[].sub | string, optional | Small caption. |

```json
{ "skills": [ { "id": "listing-reach", "label": "Listing Reach", "sub": "Weekly report" } ] }
```

## agents.json
Purpose: Hive Mind canvas and agent legend.

| field | type | notes |
|---|---|---|
| folders | string[] | Vault folder names, drawn in a ring clockwise from the top. 6-10 works best. |
| agents[].name | string | Unique; used as the drone label. |
| agents[].status | "active" / "idle" / "error" | active: drone flies to its folder and hovers with a beam. idle: docked at hub. error: docked at hub in amber. |
| agents[].folder | string or null | Must match an entry in `folders` for an active agent; otherwise the agent docks. |

```json
{ "folders": ["Listings", "Clients"], "agents": [ { "name": "Scout", "status": "active", "folder": "Listings" }, { "name": "Relay", "status": "idle", "folder": null } ] }
```

## tokens.json
Purpose: AI token usage.

| field | type | notes |
|---|---|---|
| today.total | number | Tokens used today. |
| today.input / today.output | number, optional | Informational. |
| today.budget | number, optional | Daily budget; draws a progress bar (amber at 85%+). |
| last7[] | array, up to 7 | Oldest first; last entry is highlighted as today. |
| last7[].date | string "YYYY-MM-DD" | Used for the weekday label. |
| last7[].total | number | |

```json
{ "today": { "total": 1842000, "budget": 3000000 }, "last7": [ { "date": "2026-10-30", "total": 1842000 } ] }
```

## How a server job should update the data
1. Write the new JSON to a temp file in the same directory (for example `data/.vitals.json.tmp`, same filesystem).
2. Validate it (`python3 -m json.tool`), then `mv -f` it over the real file. `mv` within one filesystem is atomic, so the page never reads a half-written file.
3. After updating any data files, rewrite `meta.json` the same way with a fresh `last_updated` (ISO 8601). The header goes amber if no job has touched it for 2 hours, so run the job at least hourly (or just refresh `meta.json` as a heartbeat).
4. To force every open screen to reload (after changing `index.html`, `style.css` or `app.js`), change `meta.version` to a new string. Screens reload within 60 seconds. Do not change `version` for plain data updates.
5. Leave `data/` readable by whatever serves the folder (for example the directory published at /srv/dashboard).
