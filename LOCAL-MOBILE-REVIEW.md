# KANDy phone pass — 2026-10-11

## Latest test-only follow-up — 2026-10-11

The source direct-unfold clipping fixture is now repaired under the renewed test-file authorization. It supplies the desktop phone profile, the original cached handoff geometry and a colour-update noop; an assert.fail guard rejects unexpected geometry remeasurement. All28 original assertion lines in the source test file remain unchanged, including six forward/reverse scroll positions and exact progress, launch and clipping expectations.

Current results: clipping1/1 plus phone-mode/cards/resize32/32 pass. Full source suite188 total:151 pass,37 fail. The remaining failures are12 historical snapshots,12 obsolete static expectations,12 mocks/extractors and1 missing Playwright. Their first causes and diagnostic text are unchanged, apart from four-line call-site offsets in the remaining direct-unfold cases. No tests were removed, skipped or weakened. Earlier38-failure counts and denied-fixture notes below describe the pre-repair checkpoint.

The source project has no Git repository. The exact already-applied source patch is therefore recorded in the release repository at Website/tests/fixtures/direct-unfold-profile.patch, with hashes and verification beside it. The historical source test suite and its old snapshots remain source-only; this does not add non-portable historical tests to the release runner.

This follow-up changes tests and records only. All12 delivered runtime/new-test files retain their published hashes. No push or deployment: the online site stays at c87a7cbb8a3bf530b313512a48b0b33d40c74f53. Physical iPhone Safari/performance validation remains outstanding. Library upload is outside this follow-up scope.

Phone implementation with publication authorized to the existing KANDy GitHub Pages site through origin/main. The website is static and uses the existing legacy Pages build. Screenshot-only Library delivery is separate and was rejected for lack of destination-specific authorization. The release copy baseline is `21f4eea`; the release target is https://kaxnvr.github.io/kandy/.

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

- Initial checkpoint: 28/28 new phone tests and 49/49 relevant regression cases pass. Final pass: phone-mode, phone-cards and phone-resize execute 32/32 passing cases; hero-meadow.js syntax passes.
- 6 changed runtime scripts and 7 HTML inline/import-map blocks pass syntax checks with bundled official Node 24.21.0.
- Full historical suite at efb0505: 184 cases, 146 pass /38 fail. Categories: 12 historical snapshots, 12 obsolete static expectations, 13 mocks/extractors, 1 missing Playwright. No additional test names failed, but this is not proof of no regression: 37 stop at the same prior first failure; 1 now hits a new missing KandyPhoneProfile mock before its older missing handoffLayout error. 25 diagnostics are identical, 5 have source-position shifts, 7 have changed source/snapshot payloads, and 1 has this changed first cause. The final full-suite rerun has188 cases:150 pass and38 fail, with four added resize cases passing. The preexisting failing set remains explicitly documented. The proposed old clipping fixture correction was again rejected by automatic approval and remains unapplied. Its assertions were not weakened and the newly exposed mock dependency is still a current test failure. Its temporary 1/1 candidate result is not counted in project totals. See failure-cause-supplement.md.
- This is a static HTML/JS project with no configured TypeScript, lint or build package command. Syntax checks, execution tests and browser checks are the available verification; no build result is claimed.

## Evidence and rollback

Source evidence lives in `Website/revisions/20261011-mobile-first/evidence/`; its JSON includes exact measurements, and TAP logs include the full-suite baseline comparison. Original files and SHA256 baseline manifest are in the same revision's `before/` and `baseline.json`.

Runtime changes: `design-a-receipt.html`, `hero-meadow.js`, `garden-journey.js`, `assets/responsive-layout.js`, `assets/stores-mist.js`, and new `assets/phone-{profile.js,layout.css,cards.css,cards.js}`. The local review page is a source-only QA aid. New tests are `tests/phone-mode.test.cjs`, `tests/phone-cards.test.cjs` and `tests/phone-resize.test.cjs`; source `phone-composition.test.cjs` now executes the tray behavior instead of matching an obsolete condition string.

## Remaining verification

- Physical iPhone Safari touch inertia, toolbar resizing, device heat and sustained FPS remain untested. DPR 2 uses more pixel work; fewer grass instances and removing a scene do not prove a frame-rate gain. Do not report 60fps or claim Safari validation.
- Check Safari logo depth/MSAA compatibility on the target phone. Configuration readouts show requested samples, not a Safari framebuffer measurement.
- Renderer quality is chosen at initial creation. Ordinary phone rotations remain phone mode; a true same-document phone-to-tablet mode transition restores the layout but does not rebuild the GPU scene with a different quality budget. Reload selects the appropriate initial profile.


## Final phone QA and corrections

- Removed the duplicate 80px root scroll padding; existing section scroll margins remain. Final Fridge anchor top: 83.9766px (84px margin), height544.6406px. Natural anchor/history navigation and menu auto-close were checked.
- Short landscape hero no longer has a360px minimum. At568x320 the hero is320px high and its primary button bottom is304px.
- Phone resize now synchronizes the camera pose before fitting the logo. The observed approximately12% rotation/cold-load scale mismatch is corrected. At932x430, fit camera and resized camera distances both10.255959; at320x568 both11.456414. The regression test executes production resize, fitLogo, cameraUpdate and repaint at four animation phases. Removing the correction makes three targeted tests fail; desktop retains its original call order.
- Phone bag close, increment, decrement and remove controls measure at least44x44px. Adding/removing a demo item and returning the bag to empty were checked at320x568.
- Final browser pass reviewed mission, Fridge, products, making, story, testimonials, stores, newsletter and footer. All five product modals opened with complete content and collapsed details. At390x844 collapsed content heights were599px or621px; all primary actions visible. At320x568 the gift-box modal is544px visible/618px content with zero horizontal overflow and scrollable secondary content. Expanded facts and demo notice remain reachable. Store focus animation is intentionally disabled in phone grid mode; these are static information entries.
- Final desktop hero checked at1728x840 with phone mode absent and zero phone disclosure wrappers. Initial full desktop checks also verified original880x536 product panel,36px title and both columns. New styles/camera order changes are explicitly phone-gated. This is visual, geometry and executed-branch evidence, not exhaustive animation equivalence or pixel matching.
- Final native-DPR2 review frame reports375x702 CSS canvas,750x1404 drawing buffer, requested logo samples2,45,360 grass instances. Actual Safari framebuffer samples, sustained FPS and heat remain unmeasured. DPR2 implies about2.19x the pixel area of1.35, so this delivery claims clarity policy and geometry reduction, not a proven FPS gain.

### What scroll-follow means in this delivery

The phone hero leaves with native page scrolling. Its logo track is pinned to0 in the handoff, the falling-letter model is unmounted, and all mission copy uses normal flow. Existing subtle breathing/wind remain. No new velocity-follow, inertia, damping or smoothing algorithm was implemented; the existing0.055 mouse lerp is not a touch-scroll smoother. If the request meant new delayed motion that follows a finger gesture, that effect remains unimplemented and requires a separately specified motion target. Native iPhone inertia was not tested.

### Scope and parity

Source-only QA: mobile-preview.html, revision backups/evidence and the updated phone-composition test. Final synchronization succeeded after renewed authorization. All12 runtime/new-test files are byte-identical between source and release; the four final phone files are included. The old direct-unfold fixture remains unchanged. The baseline is21f4eea. Work is prepared on codex/mobile-phone-20261011, then fast-forwarded to the confirmed Pages source main at repository root. Normal pushes only; unrelated sites are excluded. GitHub Pages must report success for the pushed commit before delivery.


## Final delivery constraints

- Automatic approval permitted runtime synchronization but rejected the old direct-unfold fixture write. No alternate writer or weakened assertion was used. This remains a test-maintenance blocker, not a claimed passing check. Dedicated phone handoff/desktop mapping and resize tests pass.
- Automatic approval rejected uploading five comparison screenshots to ChatGPT Library because GitHub publication authorization did not explicitly authorize that Library payload/destination. The helper did not run, there are no Library IDs, and no alternate upload destination was used. The images remain local evidence.
- No global gesture lock or scroll interception was introduced. Native flow removes desktop pinning and counter-scroll from phone movement, keeping the physical document and visible content coordinated. Touch inertia and Safari toolbar/heat behavior still need physical-device review.
