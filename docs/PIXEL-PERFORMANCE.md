# Pixel 10 Pro performance diagnosis — 2026-09-24

Measured the deployed mobile build at commit `0ae333dc1a16dd52ad561f1a45ade2274e114327` through the connected phone's Chrome DevTools protocol. Chrome 153, WebGPU adapter vendor `img-tec`, architecture `d-series`. Mobile preset was active: render scale 0.7, reflections off, motion blur off. Camera stayed fixed during comparisons.

These are short diagnostic samples (roughly 3.5–6 seconds after warmup), not sustained performance validation. FPS comes from raw requestAnimationFrame timestamps. Temporary changes were restored after each experiment.

| Experiment | FPS |
| --- | ---: |
| Baseline | 9.91 |
| Render scale reduced to 0.5 | 10.21 |
| Shadows disabled | 10.30 |
| Clouds update frozen | 10.16 |
| Ocean FFT update frozen | 23.59 |
| Caustics update frozen | 9.99 |
| Shore simulation frozen | 9.99 |
| FFT row dispatch skipped | 12.53 |
| FFT column dispatch skipped | 13.82 |
| FFT mip generation skipped | 10.16 |
| Ocean surface hidden | 10.81 |
| Lens flare dispatch skipped | 10.00 |
| FFT frozen and vegetation hidden | 27.13 |
| FFT frozen and reef hidden | 23.87 |
| FFT frozen and rocks hidden | 23.70 |
| FFT frozen and village hidden | 25.01 |

GPU timestamp profiling measured the ocean FFT pass at approximately 58.4 ms. JavaScript frame work was approximately 8–9 ms at baseline. The 60 FPS frame budget is 16.7 ms. FFT row/column compute is the primary measured bottleneck; reducing screen resolution does not materially address it. Freezing the FFT is an isolation experiment, not an acceptable production fix. Remaining scene work still limits the frozen-FFT case to approximately 24 FPS.

A timestamp initially attributed approximately 29 ms to lens flare visibility, but disabling that dispatch produced no FPS improvement. Treat that attribution as unreliable/adjacent rendering work, not evidence that flare is expensive.

Next optimization should target the mobile ocean FFT workload (currently four 256-square cascades), then remeasure the remaining rendering cost. Vegetation contributes, but removing it alone would not resolve the residual frame budget.

## Diagnostic fixes prepared during diagnosis

- Preserve uncapped elapsed frame time for FPS reporting and adaptive resolution while retaining the simulation delta cap.
- Allow adaptive resolution to respond to sustained frames slower than 100 ms; exclude stalls of one second or more.
- Wire the Shadows settings toggle to the actual shadow renderer instead of the nonexistent `app.sun` property.
- Add regression coverage for slow-frame adaptation and separate raw/simulation deltas.

The test suite and production build passed. At the time of diagnosis these changes were local; the original measured deployment did not include them. They correct diagnostics/control behavior and do not establish that the rendering bottleneck is fixed.

## Simulation optimization

Mobile now uses four 64-square FFT cascades; desktop retains four 256-square cascades. `?fft=64`, `?fft=128`, and `?fft=256` select a grid for comparisons. The smaller grids retain all cascade extents but reduce fine spatial detail. FFT stage count, bit reversal, resources, dispatch dimensions, mip generation, and downstream world-space filtering follow the selected size. Mobile also avoids the full-resolution mip staging buffers and their writes.

A separate local production-build tab on the same Pixel was loaded over USB. Tests used render scale 0.7, adaptive resolution disabled for comparison, and the original camera position `(53.654633, 3.445711, -69.053533)` and orientation. Sampling waited for at least 150 rendered frames; requestAnimationFrame ticks during the loading screen were excluded.

| Variant | Observed FFT GPU time | Full-scene FPS |
| --- | ---: | ---: |
| Original 256-square deployment | ~58.4 ms | 9.91 |
| 128-square local variant | ~15.1 ms | 13.33 |
| 64-square local variant | ~4.8–5.2 ms | 20.54 |

The final 64-square build with corrected downstream filtering repeated 20.54 FPS over six seconds (125 rendered frames, median frame interval 50 ms, p95 50.3 ms). GPU and FPS measurements are separate short samples and can vary with clocks/temperature. This is approximately twice the original scene FPS, not a 60 FPS result or a sustained thermal test. Remaining rendering costs need separate optimization.

Validation: the full test suite and production build passed. The added GPU test checks animation, finite values in all four cascades, every mip level against a box reduction, preservation of world-space filtering, and the inverse transform against an analytic two-dimensional cosine at every pixel for 64, 128 and 256 grids.

## Rendering work and image clarity

The next pass retains refraction, caustics, volumetric clouds, vegetation, foam and spray. It reduces work in these ways:

- Mobile ocean patches use a 16-square grid instead of 32; terrain patches use 32 instead of 40. Their surface shading is unchanged, but curved silhouettes have fewer vertices.
- Mobile cloud shadows cover 6 km instead of 12 km at the same 46.875 m texel spacing. A quarter of the rows updates at up to 15 Hz; camera-grid changes, settings changes and lighting changes invalidate the whole map. Visible volumetric clouds are unchanged.
- Sky irradiance retains the same 272 samples, integrates them in parallel, and reuses the result until its source sky lookup changes.
- Expired/empty or fully distance-faded spray slots skip billboard and lighting work. Water skips the second sky lookup when the refraction ray does not exit a crest, and skips shoreline noise where its contribution is exactly zero.

Controlled GPU renders of the water changes were identical in surf, aerial and underwater views; the beach comparison differed in three color channels by 1/255 over 640×360 pixels. Spray comparison changed one channel by 1/255 and preserved all 2,701 foam deposits. These comparisons isolate the shader work avoidance, not the intentional geometry reduction. New GPU regressions cover irradiance equivalence and pending-readback invalidation, cloud-shadow crop equivalence and update phases, and spray lifetime/distance/intensity boundaries.

The user requested a sharper render scale. Mobile now starts at 100% of the canvas resolution, with an 85% automatic floor; manual lower scales and URL overrides remain available. Previously it started at 70% and could automatically fall to 50%. This is relative to the CSS-sized canvas, not native device DPR. A warmed-up Pixel comparison of the previous build measured 16.66 FPS at 70% and 16.85 FPS at 100%, showing little benefit from reducing pixel count in that sample. These are six-second samples; they do not establish sustained performance or 60 FPS.

Vegetation now skips wind/gust deformation for merged plant parts of the wrong kind and instances whose existing LOD/fade has already collapsed their geometry. It preserves visible density, wind motion, LOD thresholds and the main-camera rule used by shadow passes. A GPU regression instruments gust sampling to verify hidden vertices skip it while live kinds and shadow views retain their output.

Final local build `index-DNe91wdr.js` measured **21.04 FPS at 100% render scale** at the same fixed camera (128 rendered frames over six seconds, median 50 ms, p95 50.2 ms, CPU sample 6.94 ms). The preceding public build measured **16.85 FPS at 100%** in the same session: approximately 25% higher FPS, with no reduction in render scale. The phone was warm (battery sensor reached 44.1 °C during the session); sequential samples are not temperature-controlled and do not prove a sustained gain. Shoreline, elevated and underwater views were checked on the physical Pixel. Full tests and production build passed.

## Mobile vegetation LOD

The mobile vegetation pass retains original placement, density and full-detail geometry near the player. Distant palms switch to the existing simpler mesh at 70 m instead of 120 m; tree/shrub crowns switch to baked impostors at 40/28 m instead of 65/45 m. Broadleaf and monstera clumps gain a middle mesh at 30 m; banana clumps at 40 m. Their original final fade distances remain. The middle meshes reuse the exact original vertex attributes with coarser grid indices: broadleaf 3324→1568 triangles, monstera 1664→352, bananas 1040→656. Transitions use the existing 12% dither band.

Non-shadow-casting understory is compacted against a conservative camera frustum. Shadow-casting instance lists are preserved, including offscreen casters. Candidate buffers include the full transition band and the scheduler's maximum movement margin; middle meshes have independent bounded far lists so distant invisible instances do not erase the savings. Mobile far palms and crown impostors provide cheaper, shaped shadows out to the previous shadow range.

For repeatable comparisons, `?quality=mobile&scale=1&vegetation=desktop` selects the old vegetation profile while retaining the same mobile simulation, rendering resolution and other settings. Omitting `vegetation` selects the matching device quality profile.

Headless scene validation at 960×540 measured 551,478→426,618 vegetation triangles at the beach (22.6% reduction) and 1,126,662→727,400 in the forest (35.4%). Forest vegetation draw calls increased from 11 to 14 because of the middle meshes. Foreground detail and density were visually checked; distant silhouettes and shadow shapes intentionally simplify. GPU regressions verify non-rectangular atlas shadows and prior range limits, finite geometry, exact default vertex data, culling, transition coverage and terrain-normal filtering. Full `npm test` and production build passed.
