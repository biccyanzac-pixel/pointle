# Pointle: build status (2026-10-09)

All seven phases were built in one go (the owner asked for a playable live version to test, rather than stopping after each phase). Each phase is summarised below with its decisions, open questions and anything **unverified**.

## Flags (privacy, answers, cost)
1. **Privacy: map tiles.** Map mode loads EOX satellite tiles around the player, so EOX learns the rough area (zoom 9, tiles ~45 km across in the UK). The owner chose to document this on the GitHub README rather than change the in-game note. The in-game note stays literally true (no coordinates leave the device), but players can't see the tile caveat in the game itself. Consider adding a one-line hint on the map screen.
2. **Privacy: shared globe picture** shows roughly where the player is. The game warns next to the button. It's the player's explicit choice.
3. **Privacy: fixed-spot sensor mode** asks no location. The optional "pick your town" for compass correction stays on the device.
4. **Today's answers are public.** `site/data/schedule.json` (and the deployed site) contains every future day, as with ridd-le. Anyone reading the files can see today's targets. Fixing that properly would mean serving one day at a time from the worker. Not done.
5. **Before-guess practice** never uses today's 5 targets or reserve, nor anything within 1,500 km of them, and only shows a short arrow stub (never the exit point). It's tested (`test/schedule.test.mjs`, e2e). A determined player could still estimate directions from the practice globe's coastlines. That's inherent to showing a globe at all.
6. **Cost:** everything used is free with no billing details on file: GitHub Pages, Cloudflare Workers + D1 free tier (same account as Yogle), EOX imagery (no account). No paid service was added.
7. **Licence:** EOX imagery is CC BY-NC-SA, so the game must stay non-commercial.

## Phase 1: sensor prototype ✅ (device results pending)
- `geo.js` (through-Earth direction on WGS84), `orientation.js`, `sensors.js`, `wmm.js` (World Magnetic Model 2025, matches NOAA test values), `sensors.html` device test page.
- Decisions: see `docs/sensors.md`. iOS north comes from an offset learnt while the phone is flat. Declination comes from WMM, on the device.
- **Unverified:** real iPhone and Android behaviour. `docs/sensors.md` has the checklist and an empty results table.

## Phase 2: targets and schedule ✅
- 1,416 targets: 1,210 cities (GeoNames cities15000, fame = Wikidata sitelinks damped by population), 181 landmarks (Wikidata World Heritage Sites, towers, palaces and so on, filtered), 25 hand-picked natural/famous places (`tools/extra_landmarks.json`: Everest, the poles, Machu Picchu, Giza…).
- Tiers 1–5. Mon `[1,1,1,1,1]` famous capitals → Sat `[3,4,5,5,5]` with ≥ 2 landmarks; Sun is a 1–5 mix.
- Rules (`site/js/rules.js`), all tested over the whole schedule: ≥ 3 continents; ≥ 1 target < 2,500 km and ≥ 1 > 9,000 km from London; ≥ 3 different 15° dip bands; targets ≥ 500 km apart; no target or reserve repeats within 60 days; fixed origin is a tier-1/2 city ≥ 1,000 km from all targets, not repeated within 60 days.
- Each day also has a **reserve**: if a target is < 300 km from the player (too close to point at), it's swapped in. The worker accepts that swap.
- Schedule: 820 days (2026-10-09 → 2029-01-05). After that, a seeded generator picks with the same rules (without the 60-day history).
- Open: label quality is good but not perfect (a few Wikidata labels may be odd). The landmark list was filtered by hand. Review `site/data/targets.json` if a target looks wrong. **Never change past days**: use `make_schedule.mjs --keep-until <today>`.

## Phase 3: sensor-mode game ✅
- Guess screen: heading, tilt and target name only. Lock-in averages over 0.5 s.
- Reveal: azimuthal-equidistant radar centred on the player, scaled so the target is on the edge. It rotates heading-up in sensor mode, with a live red dot at the ray's exit point and an × for the locked guess. Then the up/down bar (true angle, live tilt, guess, vibration within 5°), the 3D globe, and facts (tunnel vs flight distance, deepest point and which Earth layer).
- Score: 100 within 5°, linear to 0 at 90°. Share text with emoji, plus a `?r=` link encoding the day, mode and errors only.

## Phase 4: map mode and fixed-location mode ✅
- Map: EOX 4×4 tiles at zoom 9 on a 3D plane (north up, compass letters), 3D arrow (drag to turn, slider or arrow keys to tilt), ground shadow and drop line. Imagery decision: `docs/imagery.md`.
- Fixed spot: today's origin from the schedule, available in both sensor and map modes, with separate boards. Desktop home shows map mode plus a QR code that opens sensor mode on a phone (`?play=sensor`).
- Map entries record `phone`/`desktop` (from `pointer: coarse`), shown as 📱/💻 on the board.

## Phase 5: practice ✅
- Before finishing today: random tier ≤ 3 targets, excluded as described above, with a stub arrow. The answer line appears only after "Check".
- After finishing any mode today: today's targets selectable, plus "free explore", which shows the full line and the nearest known place where it comes out.

## Phase 6: leaderboards and groups ✅ (worker deployed separately)
- Worker + D1 (`worker/`). Boards: sensor, map, fixed-sensor and fixed-map; daily and weekly (sum of daily totals, Mon–Sun UTC); top 25 plus your own row.
- Friend groups: 6-character codes; joining shows your past and future scores on that group's board.
- Checks: server-issued sessions; day must be today (or yesterday until 02:00 UTC); targets must be that day's (fixed modes must be exactly the fixed spot's); total recomputed from the errors; all five in ≥ 10 s and each ≥ 0.5 s; profanity filter on names, towns and group names; per-IP rate limits; first submission per player/day/mode counts.
- 19 API checks: `worker/test/e2e.mjs`.

## Phase 7: AR view ✅ (unverified on devices)
- Optional, after a reveal in sensor mode: back camera plus a three.js beam along the true direction, oriented by the same sensor maths. No WebXR.

## Tests
- `npm test`: 36 unit tests (geometry vs GeographicLib, WMM vs NOAA, orientation, scoring, dates/timezones, share links, schedule rules over all 820 days, practice exclusion).
- `cd worker && npm test`: 19 API checks against the local worker.
- `node test-e2e/privacy.e2e.mjs`: full map game on desktop and full sensor game on an emulated phone, practice gate, leaderboard submit. Every request is checked for coordinates (with a self-test proving the detector catches leaks), plus localStorage.

## TODO / ideas
- Real-device test results (see `docs/sensors.md`).
- Serve the schedule one day at a time to hide future answers.
- Archive of past days (like Yogle).
- A licence for Pointle's own code.
