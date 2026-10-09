# Map imagery for map mode: comparison and decision

**Decision: EOX Sentinel-2 cloudless ("EOxCloudless"), 2024 layer.** It is the only option that needs no account, no API key and no billing details, so it **cannot** generate a bill at any scale. Integrated in `site/js/mapview.js`.

## What map mode needs
- A zoomed-out satellite view around the player: a 4 × 4 grid of 256-px tiles at zoom 9 (about 150 km across in the UK). That's **16 tiles per map-mode session**; the browser caches them (EOX sends `Cache-Control: max-age=604800`).
- Expected scale: a few hundred to a few thousand map games a day, so roughly 5k–50k tiles a day, up to about 1.5 M a month at the top end.
- Use from a browser on a static site (CORS), with the attribution shown on the map.

## Options

| Option | Cost model | Account/key | Licence and terms (summary) | Resolution | Verdict |
|---|---|---|---|---|---|
| **EOX Sentinel-2 cloudless** (tiles.maps.eox.at) | Free WMTS; no billing exists for it | None | 2018–2025 layers: **CC BY-NC-SA 4.0** (non-commercial); 2016 layer: CC BY 4.0. The attribution string is required and must be shown "legibly and in proximity". The licence page states no volume caps or rate limits. Commercial users buy a licence. | 10 m (fine at zoom 9) | **Chosen.** Zero cost risk, and Pointle is non-commercial anyway. |
| Esri World Imagery (ArcGIS Location Platform) | Free tier of **2 M basemap tiles/month**; beyond that, pay-as-you-go if billing is enabled | ArcGIS account + API key (shipped in client code) | Attribution "Esri, Maxar, Earthstar Geographics…". Terms require an ArcGIS account for production use. | Sub-metre | Best imagery. Free at our scale, but needs an account and has a possible-cost path. **Ask before using.** |
| Google Maps Platform (Map Tiles API / Maps JS satellite) | Monthly free usage per SKU, then billed | Google Cloud project **with a billing card** | Strict terms: limited caching, Google logo and attribution required, no use outside Google maps for some products. | Sub-metre | Rejected: a billing card is mandatory, so overspend is possible. |
| MapTiler Cloud free plan | Free plan with a monthly request quota (~100k); the service stops when it's exceeded (no overage on the free plan) | Account + key | Free plan is non-commercial; attribution required | High (satellite-v2) | Would run out at our upper estimate. Paid plans cost money. |
| Mapbox (raster satellite) | Free monthly allowance (about 750k raster tile requests), then billed | Account + **card required** | Attribution and logo required | High | Rejected: a card on file means overspend is possible. |
| NASA GIBS (Blue Marble, MODIS/VIIRS) | Free, no key | None | Public domain (NASA) | 250 m–500 m | Viable free fallback, but blurry at local zoom. |
| Bing Maps | Basic/free accounts being retired by Microsoft | — | — | — | Not suitable. |

The figures for the paid providers are from memory of their published plans. **Check them before switching**, because they change often. The EOX terms were checked on their licence page during this build (2026-10-09).

## Caveats
- **Non-commercial:** the EOX licence (NC) means Pointle mustn't carry ads, paid tiers or sponsorship while it uses this imagery. If that changes, buy an EOX licence or switch to Esri (ask first).
- **Privacy:** tile requests reveal the player's rough area (one zoom-9 tile is ~78 km at the equator, ~45 km at UK latitudes) to EOX. This is documented in the README. Fixed-spot mode only requests tiles of the public fixed city.
- **Availability:** EOX gives no SLA for the free WMTS. If tiles fail, the map shows a plain grid and the game still works (the arrow, compass and readouts don't depend on imagery).
