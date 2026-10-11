# KANDy phone pass — 2026-10-11

Local implementation only. Nothing was pushed, uploaded, or deployed. The release copy baseline is `21f4eea`; the public site was not modified in this pass.

## Open locally

- Main site: http://127.0.0.1:4173/Website/design-a-receipt.html
- Phone review: http://127.0.0.1:4173/Website/mobile-preview.html
- Start from the source root with `python3 Website/devserver.py 4173` if the existing server is stopped.
- The review page provides 390×844, 375×667 and 844×390 frames. Its `phone-preview=1` override works only on localhost. Real phones are selected through coarse pointer plus phone dimensions; ordinary fine-pointer desktops do not enter this mode.

## Changes

- Phone hero keeps the same candy model, grass world and main rendering materials. Phone DPR is fixed at up to 2, independent of measured frame rate. Main grass stays at 12,000 blades; distant and extra portrait layers reduce the total target from 90,360 to 45,360. No global resolution downgrade was added. Logo target requests 2 samples; out-of-focus rendering has a separate quarter-scale target.
- Phone body now uses natural document flow. All six mission sentences remain readable, and the falling-letter model is not mounted over product content. Desktop retains its original cinematic handoff and horizontal collection journey.
- Fridge uses a smaller complete photograph, clear title/lead/action, and native expandable secondary information. Product modal keeps description, price, quantity and add action together, with product facts expandable. No copy or product artwork was removed.
- A shared phone profile covers portrait and landscape. Receipt is not mounted and stores stay in a static readable grid when a phone rotates beyond 701px. Menus remain the phone menu. Combined media events read current state to avoid a transient desktop activation on rotation.
- Desktop CSS defaults, original quality tiers, camera math, assets, product order and full card content are retained. New visual styles require `html[data-kandy-phone="true"]`.

## Verified results

Local Chrome simulation, not a physical iPhone or Safari test:

| Check | Before | After |
|---|---:|---:|
| Fridge, 390×844 |916px|545px|
| Product content height,390×844 |867px;812px visible|599px;all visible|
| PDP image height |283px|180px|
| PDP,375×667 |—|593px;no internal scroll while collapsed|
| Hero native DPR 2 frame |old phone cap1.35, adaptive floor1.053|DPR 2,750×1404 buffer for375×702 CSS canvas|
| Desktop PDP |880×~536px|880×536px, same 36px title and two columns|

Landscape phone at 844×390 retained DPR 2 (1658×780 buffer), hid/unmounted falling letters and had no receipt canvas. Stores showed three static columns. Landscape PDP intentionally scrolls slightly (366px visible /394px content) instead of squeezing text. No horizontal document overflow was observed in the390px simulation.

Browser checks covered: complete mission copy, both disclosures, quantity increase, demo add/remove, empty bag restoration, reopening product details, phone menu navigation, portrait/landscape return, reverse wheel scrolling in the phone frame, desktop Shop navigation and original desktop modal. No console errors appeared; the baseline warning about importing multiple Three.js instances remains.

Desktop screenshots before and after use slightly different native window heights (840/784), and the meadow animates procedurally. They support regression review, not pixel equality.

## Tests

- 28/28 new phone tests and 49/49 relevant regression cases pass.
- 6 changed runtime scripts and 7 HTML inline/import-map blocks pass syntax checks with bundled official Node 24.21.0.
- Full historical suite: 184 cases, 146 pass /38 fail. Every current failure also occurs against the verified pre-change runtime. They include superseded layout snapshots, incomplete older DOM mocks and a missing Playwright dependency. No dependency was installed and these historical cases were not rewritten for this pass.
- This is a static HTML/JS project with no configured TypeScript, lint or build package command. Syntax checks, execution tests and browser checks are the available verification; no build result is claimed.

## Evidence and rollback

Source evidence lives in `Website/revisions/20261011-mobile-first/evidence/`; its JSON includes exact measurements, and TAP logs include the full-suite baseline comparison. Original files and SHA256 baseline manifest are in the same revision's `before/` and `baseline.json`.

Runtime changes: `design-a-receipt.html`, `hero-meadow.js`, `garden-journey.js`, `assets/responsive-layout.js`, `assets/stores-mist.js`, and new `assets/phone-{profile.js,layout.css,cards.css,cards.js}`. The local review page is a source-only QA aid. New tests are `tests/phone-mode.test.cjs` and `tests/phone-cards.test.cjs`; source `phone-composition.test.cjs` now executes the tray behavior instead of matching an obsolete condition string.

## Remaining verification

- Physical iPhone Safari touch inertia, toolbar resizing, device heat and sustained FPS remain untested. DPR 2 uses more pixel work; fewer grass instances and removing a scene do not prove a frame-rate gain. Do not report 60fps or claim Safari validation.
- Check Safari logo depth/MSAA compatibility on the target phone. Configuration readouts show requested samples, not a Safari framebuffer measurement.
- Renderer quality is chosen at initial creation. Ordinary phone rotations remain phone mode; a true same-document phone-to-tablet mode transition restores the layout but does not rebuild the GPU scene with a different quality budget. Reload selects the appropriate initial profile.
