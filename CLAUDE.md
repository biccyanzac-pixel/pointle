# Pointle: notes for coding agents

Start with **docs/build-status.md**, then README.md.

Critical rules:
- **Privacy promise:** the player's coordinates must never leave the device: not to the worker, not into URLs, storage, logs or share text. `site/js/app.js` keeps them in memory only (`S.origin`). Run `node test-e2e/privacy.e2e.mjs` after any change that adds a request. The only location-related request is the map-mode EOX tiles (zoom ≤ 9), documented in the README.
- Never change a past or current day: don't regenerate `site/data/schedule.json` from scratch once live; use `node tools/make_schedule.mjs --keep-until <today>`. Keep target ids stable.
- After changing `site/data/*.json` or `site/js/{daily,rules,scoring,names,geo}.js`, redeploy the worker (`cd worker && npx wrangler deploy`): it bundles them to validate submissions.
- Free/non-commercial project (EOX imagery is CC BY-NC-SA): ask the owner before adding any paid service, restrictive-licence dependency or analytics.
- Commit as `biccyanzac-pixel <285977456+biccyanzac-pixel@users.noreply.github.com>` (repo-local config). Deploy the site with `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.
- Local ports: site 8080, worker 8799 (8798 is predictle's, 8797 yogle's).
