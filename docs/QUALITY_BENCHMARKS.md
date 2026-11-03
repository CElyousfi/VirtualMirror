# Quality benchmarks

Rule: a number appears in the **Measured** column only with its device, OS, browser, and conditions. Everything else is a target.

## 1. Device performance (live mirror)

Collected with `?vm_debug=1` on a product page, or from `window.VirtualMirror.lastSession` after closing.

| Device | OS / browser | Network | Camera ready | Tracker ready | First tracked | Avg fps | Avg / p95 detect ms | Delegate | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| *(none measured yet)* | | | | | | | | | |

Targets (not results): 30 fps on supported modern phones; tracker ready under 5 s on Wi-Fi.

## 2. Product fidelity (asset preparation)

Two separate datasets, never mixed (ChatGPT review, correction #1).

### Representative dataset — decides architecture

- 50 SKUs **randomly sampled** from 3–5 permission-cleared independent eyewear catalogs, keeping their real mix of shapes, photos, variants and missing data.
- No hand-picking. Record the sampling method and seed.
- This set alone answers "what share of a real catalog can we prepare automatically?"

### Challenge dataset — decides rejection logic

- Deliberately hard SKUs: clear and light frames on white, rimless, semi-rimless, mirrored lenses, lifestyle-only photos, missing dimensions, tortoise patterns.
- Success here means **correct rejection** (Unsupported or Needs review), not automation.

### Metrics, reported separately for each dataset

| Metric | Definition |
| --- | --- |
| Automation rate | Share reaching Ready with no manual geometry work |
| **False approvals** | Share reaching Ready that a human judges unfaithful. Target 0; any false approval is a release blocker |
| Merchant intervention | Minutes of merchant input per SKU to reach Ready |
| Front fidelity | Re-projection IoU vs the source front photo (necessary, not sufficient) |
| **Independent-view fidelity** | Agreement with a photo **not used** for reconstruction (side or three-quarter) |
| **Physical fidelity** | Side-by-side of a person wearing the real frame vs the rendered frame, same pose; blind panel score 1–5 |
| Dimensional error | mm error of lens, bridge and front width vs the arm print |
| Material fidelity | Colour difference (OKLab) under neutral light + blind panel rating |
| Processing time | Wall-clock per SKU, stage by stage, on named hardware |

Re-projection against the same photo used for reconstruction is never reported alone (ChatGPT review, correction #6).

## 3. Results

| Dataset | Date | Engine commit | Automation | False approvals | Intervention | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| *(no runs yet: the 2.5D method does not exist yet)* | | | | | | |
