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
