# KANDy phone hero centre — 2026-10-13

Current scope: centre the large pink 3D KANDy lettering in the visible phone first screen. The navigation logo is unchanged. This is a local review change; do not push or deploy without fresh authorization. Published runtime remains c87a7cb; local release work started at9b21b70.

## Change

Only `Website/hero-meadow.js` changes runtime behavior. Phone portrait uses an off-axis camera view offset: half the difference between the visual viewport and stable canvas height, plus1.8% of canvas height to account for grass hiding the lower lettering. This shifts the whole3D composition and preserves the existing logo scale, FOV, camera position, materials and grass occlusion. Navigation, lead, CTAs, DOM layout and hero height are unchanged. No scenery zoom was needed.

The shift is bounded to[-10%,18%] of canvas height for unusual aspect ratios, prioritizing the overlay region over exact centring on extreme screens. Stable-canvas visualViewport changes update projection/repaint without reallocating targets or refitting the logo. Scroll, pinch zoom and focused inputs hold the current framing; returning to the top updates it. Orientation/actual canvas changes are measured normally. Landscape clears the portrait offset. Fine-pointer desktop never enters this path. New viewport/scroll listeners are removed on disposal.

## Actual local Chrome evidence

`final-browser.json` and `final-browser.mjs` record the actual app, mobile viewport/touch profile, dimensions, projection matrices and navigation/lead/CTA bounds. Browser contexts were isolated; no existing browser tabs or KAXFLUX4342 were used. These are Chrome simulation checks, not physical iPhone/Safari claims.

Same-phase paired screenshots temporarily clear and restore the view offset in the browser, holding all model/scene values constant. All projection-matrix entries except vertical translation are identical; model width is preserved. `pixel-measure.json` measures large pink connected components after excluding the navigation logo and small decorations. This is an optical silhouette approximation at one animation phase, not an all-frame guarantee.

|Viewport|Original optical centre Y|New centre Y|Visible screen centre|New error|
|---|---:|---:|---:|---:|
|390×700|335.5|349.0|350|−1.0px|
|390×844|338.0|420.5|422|−1.5px|
|375×667|320.5|332.5|333.5|−1.0px|
|430×932|372.0|465.5|466|−0.5px|
|320×568|272.5|281.5|284|−2.5px|

Pink silhouette widths are identical except one raster pixel at390×844. The reference-sized short viewport shifts by12.6CSSpx, consistent with the parent conversation's approximately30px downward request on the942px-wide screenshot. Taller phone windows need additional compensation because the existing hero is capped at180vw.

All five portrait sizes retain visible CTAs and no horizontal document overflow.844×390 landscape has disabled view offset; portrait→landscape→portrait restores the expected offset. At390×844, scrolling120px then increasing visible height to900 retains83.636px framing; returning to top updates111.636px, avoiding a counter-scrolling logo.1440×900 desktop has camera.view=null and no phone framing attribute. Browser recorded no page errors. Screenshots were visually inspected for composition, grass coverage and text/button visibility.

## Validation

Syntax check passes. Existing phone-mode/cards/resize suite:36/36pass, including4 new tests for stable-canvas viewport updates/no reallocation, scroll/pinch/input hold, landscape/desktop exclusion and extreme-height bounds. Existing cold/rotated camera-phase checks remain unchanged. The release's six supported mobile suites also pass53/53 after synchronization; see `validation.txt`. Source and release runtime/test SHA-256 hashes match.

Source has no Git repository. `hero-meadow.before.js` is the exact source backup. The release repository records the runtime/test patch and this evidence; the full historical source suite is not copied into release. The previously reported37 historical full-source failures are not rerun or changed by this scope. No font installation, upload, push or deployment.
