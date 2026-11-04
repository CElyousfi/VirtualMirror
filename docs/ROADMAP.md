# Roadmap

The full product specification and the A–F feasibility review live outside the repo (founder's brief; Claude review doc). This file tracks milestones and their acceptance tests.

| Milestone | Acceptance | Status |
| --- | --- | --- |
| **M1 Shopify vertical slice** | A development-store product page opens the live mirror and shows tracked 3D glasses | Code complete, CI green, headless-verified. **Awaiting first real install** ([SETUP.md](SETUP.md)) |
| QA Lab (internal) | Real renderer output comparable against real eyewear, with reproducible reports | Built; first real-footage and real-product reports pending ([VISUAL_QA.md](VISUAL_QA.md)) |
| M2 Rendering quality | Documented, visually convincing mirror on named devices; side-by-side with physical frames | Not started |
| X 2.5D experiment (parallel) | Representative-dataset automation rate and zero false approvals on the challenge set | Not started; needs permission-cleared catalogs |
| M3 Autonomous preparation in product | A non-technical tester prepares eligible pilot SKUs without developer contact | Blocked on X decision gate |
| M4 Productization | Another person installs and uses the app without help | Not started |
| M5 Commercial pilot | Paying pilot demand and workable unit economics | Not started |
| M6 Public launch | Shopify app review approved | Not started |

## Immediate next tasks (M1 close-out)

1. Founder: SETUP.md steps 1–8.
2. Fix anything the first real install exposes.
3. Record Diagnostics results; confirm or replace the Files storage path.
4. First real-phone measurements (iPhone Safari, Android Chrome).
5. First real product through the QA Lab: photos, measurements, consented test video, ideally a manually prepared GLB.
