# Pointle

A daily game: three places a day, and you point at each one in a **straight line through the Earth**. Nearby places are just below the horizon, and the other side of the world is nearly straight down. Your score is the 3D angle between where you pointed and the true direction.

**Play:** https://biccyanzac-pixel.github.io/pointle/  ·  sensor test page: https://biccyanzac-pixel.github.io/pointle/sensors.html

New here (human or agent)? Read [docs/build-status.md](docs/build-status.md).

## Privacy
> Your precise location never leaves your phone or computer — all the maths happens on your device. The leaderboard only shows the nearest town to where you played from (worked out on your device), the town you picked, or that you used the fixed spot.

How that holds, and its one caveat:
- Location comes from the browser's geolocation API (or a town you pick from a list that's built into the site and searched on your device). It stays in memory. It isn't stored, logged, put in links or sent to the leaderboard.
- The leaderboard receives your nickname, scores, per-target errors and timings, mode, device type (phone or desktop), the day's target ids, and a **town name**: the nearest town (population 15,000+) to where you played from, found on your device from the built-in list; or the town you picked, marked "(picked)"; or "Fixed spot: <city>". Never coordinates. Players who want no town shown can use the fixed spot.
- **Map mode caveat:** the satellite picture of your surroundings is loaded as image tiles from EOX (tiles.maps.eox.at). EOX can see *which* tiles were requested, which reveals your rough area (tiles are about 50 km across at the zoom used; nothing more precise is ever requested). No coordinates are sent. Fixed-spot mode only loads tiles of the public fixed city, and sensor mode loads no map tiles at all.
- The optional "share globe picture" image shows roughly where you're pointing from. The game warns you before you share it.
- `test-e2e/privacy.e2e.mjs` plays full games in a real browser with a mocked GPS fix and fails if any request (URL, headers or body) contains the coordinates, or goes to an unexpected host.

## Develop
```
npm install
node tools/serve.mjs                 # http://localhost:8080/  (geolocation works on localhost; phone sensors need HTTPS)
npm test                             # unit tests: geometry, WMM declination, orientation maths, scoring, dates, schedule rules
cd worker && npm install && npm run db:init:local && npm run dev:local     # leaderboard on :8799
cd worker && npm test                # 22 API checks against the local worker
node test-e2e/privacy.e2e.mjs        # browser end-to-end + privacy check (needs both servers; uses installed Chrome/Edge)
```
Open the site against the local worker with `http://localhost:8080/?api=http://127.0.0.1:8799`.

Data pipeline (only needed to change targets):
```
# download cities15000.zip (unzipped), countryInfo.txt and admin1CodesASCII.txt from https://download.geonames.org/export/dump/ into DIR
node tools/fetch_wikidata.mjs DIR    # fame (Wikipedia sitelink counts) + landmarks from Wikidata
node tools/build_targets.mjs DIR     # site/data/targets.json + towns.json
node tools/make_schedule.mjs --keep-until <today>   # NEVER regenerate past or current days once live
node tools/build_land.mjs            # coastlines
node tools/build_radar_land.mjs      # the reveal radar's pre-simplified coastlines (re-run after build_land)
```

## Deploy
Same pattern as Yogle and ridd-le (and listed on the [jacob.gg hub](https://biccyanzac-pixel.github.io/jacob.gg/)): GitHub Pages serves the `gh-pages` branch (a mirror of `site/`), and the leaderboard is a Cloudflare Worker + D1 database.
```
git push origin main
git subtree split --prefix site -b gh-pages && git push -f origin gh-pages
cd worker && npm run db:migrate     # only for a schema change: run the migration BEFORE deploying code that needs it
cd worker && npx wrangler deploy     # redeploy whenever site/data/*.json or site/js/{daily,rules,scoring,names,geo}.js change
```

## Layout
- `site/`: the static website
  - `js/geo.js` (through-Earth directions, WGS84), `js/wmm.js` (World Magnetic Model declination), `js/orientation.js` (device orientation to pointing direction), `js/sensors.js` (live sensor stream), `js/scoring.js`, `js/daily.js` (dates, seeding), `js/rules.js` (daily target rules, practice exclusions), `js/radar.js`, `js/globe.js`, `js/mapview.js`, `js/compass.js`, `js/ar.js`, `js/app.js` (UI, laid out like ridd-le)
  - `data/targets.json`, `data/schedule.json` (820 days from 2026-10-09, 3 places + reserve + fixed spot per day), `data/towns.json`, `data/land-*.json` (globe), `data/radar/land-*.json` (radar: the same coastlines with per-zoom detail levels, from `tools/build_radar_land.mjs`)
  - `sensors.html`: device test page
- `worker/`: leaderboard API (Cloudflare Worker + D1)
- `tools/`: data builders, schedule generator, local server
- `test/`: unit tests; `test-e2e/`: browser and privacy test
- `docs/`: decisions, device tests, imagery comparison, status

## Credits and licences
- Places: [GeoNames](https://www.geonames.org/) (CC BY 4.0). Landmarks and fame: [Wikidata](https://www.wikidata.org/) (CC0).
- Coastlines: [Natural Earth](https://www.naturalearthdata.com/) (public domain), via world-atlas.
- Magnetic declination: World Magnetic Model 2025, NOAA NCEI / BGS (public domain).
- Map imagery: EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0. Because of this licence, Pointle must stay **non-commercial**.
- three.js (MIT), qrcode-generator (MIT).
- No licence has been chosen yet for Pointle's own code.
