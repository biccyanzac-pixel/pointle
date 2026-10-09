# Sensors: how pointing works, and device test results

## Maths (all on the device)
- **True direction:** both places are converted to Earth-centred 3D coordinates on the WGS84 ellipsoid. The difference vector is expressed in the player's local East-North-Up frame. "Up" is the ellipsoid normal, which is what a phone's gravity sensor measures. Azimuth = compass bearing of that vector; elevation = angle above (negative: below) the horizon. Code: `site/js/geo.js`.
- **Score error:** the full 3D angle between the guess vector and the true vector (`atan2(|a×b|, a·b)`, stable near 0° and 180°). The reveal also splits it into "too far left/right" (azimuth difference) and "too high/low" (elevation difference).
- **Device orientation:** W3C convention, `R = Rz(alpha)·Rx(beta)·Ry(gamma)` maps device axes to Earth axes. The pointing axis is:
  - **camera:** out of the back of the phone, device `−z`. Screen rotation doesn't change it.
  - **top edge:** the top of the screen *as currently displayed*, device `(sin θ, cos θ, 0)` where θ = `screen.orientation.angle`. In landscape the "top edge" is the physical side edge that's now at the top of the picture, so the readouts always match what the player sees.
  - Code: `site/js/orientation.js`, tested in `test/orientation.test.mjs`.
- **North reference, by platform:**
  - *Android (Chrome, Edge, Samsung Internet):* `deviceorientationabsolute`. Alpha is referenced to **magnetic** north (Android's rotation-vector sensor).
  - *Firefox Android:* `deviceorientation` with `absolute: true` (magnetic).
  - *iOS (Safari, and every iOS browser since all use WebKit):* alpha is relative to an **arbitrary** direction fixed at page load. A separate `webkitCompassHeading` is magnetic and tilt-compensated. When the phone is held flat, every definition of "heading" agrees (it's where the top edge points), so we learn `offset = webkitCompassHeading − top-edge azimuth` only while the phone is flat (flatness > 0.9), as a circular running mean, and keep it as the phone is raised. That's why setup asks iPhone users to hold the phone flat for a moment. If `webkitCompassHeading` turns out to behave differently on some iOS version, this keeps working, because it's only sampled in the flat pose.
  - Permission: iOS needs a tap ("Enable compass") to call `DeviceOrientationEvent.requestPermission()`. Recent desktop/Android Chrome also exposes that function; it's called the same way.
- **Magnetic vs true north:** all of the above are magnetic, so every reading is rotated by the **magnetic declination** at the player's position. It's computed on the device with the World Magnetic Model 2025 (`site/js/wmm.js`), which matches all 12 official NOAA test values (`test/wmm.test.mjs`). UK declination is currently small (London +1.2°, Leeds +0.5°, Belfast −1.2° in Oct 2026), but it reaches 5° in Berlin and 12–15° in New York and Seattle, so it matters there. In fixed-spot sensor mode the player's real position isn't known, so declination defaults to 0°, with an optional on-device town pick to correct it.
- **Smoothing:** the display uses the mean direction of the last 150 ms. **Locking in** uses the mean unit vector over the last **0.5 s**.
- **Accuracy:** iOS reports `webkitCompassAccuracy` (degrees). Above 25° the game warns and suggests a figure-8. Android browsers don't expose accuracy, so the game always shows the figure-8 prompt and says accuracy isn't reported.

## Automated checks (pass)
- Bearings vs GeographicLib geodesics for 10 city pairs (within 0.1°, or 0.5° for near-antipodal pairs); published great-circle distances (London–New York 5,570 km, London–Sydney 16,990 km); chord length vs ECEF distance; the dip equals half the central angle; the antipode points straight down (exactly on the equator and at the poles; within 0.2° at mid-latitudes because of the ellipsoid).
- Orientation: flat/upright/tilted poses, alpha direction, screen rotation (top edge follows it, camera doesn't), orthonormal matrix, declination rotation, iOS offset learning.
- End-to-end: a full sensor-mode game in an emulated phone driven by synthetic `deviceorientationabsolute` events (`test-e2e/privacy.e2e.mjs`).

## Real-device testing: NOT DONE YET
Real phones are needed for this. The device test page is https://biccyanzac-pixel.github.io/pointle/sensors.html (HTTPS is required for sensors). Use **Copy report** and paste the results below.

### Checklist (do on each phone, with both methods)
| # | Check | Expected |
|---|---|---|
| 1 | Tap Enable compass (iPhone: choose Allow) | Event kind `ios` (iPhone) or `absolute` (Android); events/sec ≥ 20 |
| 2 | iPhone: hold flat ~2 s | "iOS needs flat" turns false; offset appears |
| 3 | Camera method, upright, aim at a known bearing (map, or a compass app on another phone) | Heading within ~5–10° |
| 4 | Camera method: level / aim at floor / aim at ceiling | Tilt ≈ 0° / ↓ 90° / ↑ 90° |
| 5 | Top-edge method, flat, compare with the phone's compass app | Heading within ~5° (compass apps usually show magnetic or true: check which) |
| 6 | Top-edge method, rotate the screen to landscape (both ways) | Heading follows the visual top edge |
| 7 | Camera method, landscape | Heading unchanged from portrait for the same aim |
| 8 | iPhone: raise from flat to upright and walk in a circle | Heading stays consistent; no 180° jumps |
| 9 | Full game, reveal screen | Radar rotates heading-up as you turn; vibration near the true direction (Android only: iOS has no vibrate API) |
| 10 | AR view | Camera feed with a green beam heading into the ground towards the target; beam stays fixed as you turn |

### Results
| Device | OS / browser | Method | Results | Notes |
|---|---|---|---|---|
| iPhone (owner to fill in) | | camera / top | | |
| Android (owner to fill in) | | camera / top | | |

## Open questions / unverified
- Behaviour of `webkitCompassHeading` when upright on current iOS: the design avoids depending on it, but it's untested.
- Whether any Android browser reports alpha referenced to **true** north (that would double-correct by the declination). Chrome documents magnetic. In the UK the effect would be ≤ 2°.
- AR field of view is assumed to be 60° vertical. Phones differ, so the beam can look slightly off-axis at the screen edges.
