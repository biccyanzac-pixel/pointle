# Pointle: notes for coding agents

Start with **docs/build-status.md**, then README.md.

Critical rules:
- **jacob.gg house rules and shared kit:** read `../jacob.gg/PLAYBOOK.md` before changing the look, the results screen, the leaderboard flow or the leaderboard table. The page loads `jacob.gg/kit/jgg.css` + `jgg.js` (colours, font, masthead, weekday level, rating box): don't redefine the kit's base CSS here. If the leaderboard table changes, update the hub's `worker/src/sources.js` so plays keep counting.
- **Privacy promise:** the player's coordinates must never leave the device: not to the worker, not into URLs, storage, logs or share text. `site/js/app.js` keeps them in memory only (`S.origin`). Run `node test-e2e/privacy.e2e.mjs` after any change that adds a request. The only location-related request is the map-mode EOX tiles (zoom ≤ 9), documented in the README.
- Never change a past or current day: don't regenerate `site/data/schedule.json` from scratch once live; use `node tools/make_schedule.mjs --keep-until <today>`. Keep target ids stable.
- After changing `site/data/*.json` or `site/js/{daily,rules,scoring,names,geo}.js`, redeploy the worker (`cd worker && npx wrangler deploy`): it bundles them to validate submissions.
- Free/non-commercial project (EOX imagery is CC BY-NC-SA): ask the owner before adding any paid service, restrictive-licence dependency or analytics.
- Commit as `biccyanzac-pixel <285977456+biccyanzac-pixel@users.noreply.github.com>` (repo-local config). Deploy the site with `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.
- Schema changes: add `worker/migrations/000N_*.sql`, run it on the live DB (`npm run db:migrate` style) BEFORE deploying code that needs it, and export a backup first, checking the export actually succeeded.
- Three places a day (`TARGETS_PER_DAY` in `site/js/scoring.js`); schedule rows are `[...targets, reserve, origin]`.
- Local ports: site 8080, worker 8799 (8798 is predictle's, 8797 yogle's).
