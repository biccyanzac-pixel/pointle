# Pointle: build status (2026-10-09)

## Update 3 (owner feedback, 2026-10-09 evening)
- **Privacy note changed (owner's request).** The leaderboard no longer asks for a town. It shows where you played from automatically: the nearest town (pop. 15,000+) to your location, found on the device from the built-in list ("Leeds, UK"); or the town you picked ("Leeds, UK (picked)"); or "Fixed spot: Volgograd". It's still never coordinates, and the fixed spot shows nothing about you. The in-game note, README and schema comment were updated to say exactly this. A "hide my town" option could be added if players want one.
- **Places always say where they are**: the guess heading reads "Point at East London, South Africa". US, Canadian and Australian cities include the state or province ("Columbia, South Carolina, USA"). `targets.json` gained an `r` (region) field; ids, order and the schedule are unchanged (checked byte-for-byte).
- **Location on iPhone gave no prompt.** iOS shows none when location is off for the browser in Settings: it just refuses. The page now checks the permission state, says "Blocked by your browser settings", and shows browser-specific steps (Safari: Location Services → Safari Websites, plus Settings → Apps → Safari → Location; Chrome/Firefox/Edge on iOS: their own Location Services entry). If nothing happens for 8 s it says so, then focuses the town picker.
- **Tilt slider level** in map mode: sky/earth strip, horizon line and "level" mark, like the phone gauge.
- **Practice uses the same controls as guessing**: the map with the draggable arrow, compass and sliders (or the phone's compass dial), with the globe below for checking.

## Update 2 (same day, after the owner's first play-test)
- **3 places a day** (was 5), still seeded from the UTC date. The schedule was regenerated from puzzle #1, because only test plays existed. Weekday tiers are now Mon `[1,1,1]` → Sat `[4,5,5]` (≥ 1 landmark), Sun `[1,3,5]`. All schedule rules still hold over the 820 days: every place on a different continent, one near and one far from London, three different dip bands. Max score 300. The worker's "too fast" limit is now 6 s for all three.
- **ridd-le layout**: jacob.gg wordmark (links to the hub). The game lives in one card; today's leaderboard card is always visible below it (no top nav). Then yesterday's places and winners per mode, then an **archive** (replay any past day; scores go on that day's separate "late" board, like ridd-le). How to play and privacy are in the footer. Light and dark themes come from ridd-le's tokens. Added to the jacob.gg hub.
- **Map mode**: grab the arrow's white tip and drag it in 3D. The tip follows the cursor over a sphere, choosing the front or back side for continuity, so it can swing under the ground. Dragging elsewhere turns it. There's also a heading slider plus the tilt slider, and a compass dial at the top that rotates with the arrow.
- **Phone mode**: a real compass dial (the rose turns so north on the dial points to real north, with your facing at the top marker) plus a tilt gauge.
- **After each guess** the globe shows a live red arrow that follows the phone (or, in map mode, your drags on the radar and bar). The globe stays draggable. The locked guess is white, the true line green.
- **AR**: a yellow "satnav" arrow floats just in front of the camera and points the true way, so it can't leave the frame. A hint says "turn right 40°, tilt down 25°" (or 🎯 when within 5°).
- **Location on phones**: tries a quick fix, then retries with GPS. Errors now say why (blocked / timed out / unavailable / in-app browser / not https), with iPhone and Android instructions. The town picker stays as the fallback. *Root cause of the owner's failure is unknown*: the exact message shown is needed.
- Worker: `is_late` column (migration `worker/migrations/0001_late_board.sql`, applied to the live DB). One entry per player, day, mode and board.
- The one live row (a 5-place map score, 199/500) was removed because today's puzzle changed. **Mistake:** the export that was meant to back it up failed (Cloudflare API error 7403) and the delete ran anyway. It's recoverable with D1 Time Travel until 2026-10-16 (bookmark `00000002-00000004-000050ff-80f9bbaffcb9f0cadd23e14438ada1de`; restoring rolls back the whole DB, so re-run the migration after).


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
