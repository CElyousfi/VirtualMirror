# Setup: run Virtual Mirror on a development store

These steps need your Shopify account, so they cannot be run from the build sandbox. Everything is free. Never use your live store for any of this.

Time: about 30 minutes the first time.

## Which steps need your Shopify login

Claude cannot do these: they need your Shopify account, a browser session, and a phone. Use a **development store** only, never a live merchant store.

| Step | Needs your Shopify login? | Where it happens |
| --- | --- | --- |
| 1.4 Create Partner / Dev Dashboard account | **Yes** | partners.shopify.com |
| 1.5 Create a development store | **Yes** | Dev Dashboard |
| 2 Clone, install, `pnpm check` | No | Your computer |
| 3 `pnpm config:link` | **Yes** (CLI opens a browser to log in) | Your computer + browser |
| 4 `pnpm dev`, approve install | **Yes** | Your computer + Shopify admin |
| 5 Sync, prepare, approve, publish | **Yes** (inside the Shopify admin) | Virtual Mirror app in admin |
| 6 Add the Try On Live block | **Yes** (theme editor) | Shopify admin |
| 7 Try on a phone | No Shopify login; only the dev store's storefront password | Phone browser |
| 8 Diagnostics | **Yes** (inside the Shopify admin) | Virtual Mirror app in admin |

## Integration test checklist

This is the Milestone 1 integration test. Record each line in `docs/qa-reports/` (see [VISUAL_QA.md](VISUAL_QA.md)).

| # | Confirm | Step | Evidence to keep |
| --- | --- | --- | --- |
| I-1 | The app syncs a test eyewear product | 5.2 | Screenshot of Products showing it as "Eyewear" |
| I-2 | The product is associated with the demo GLB | 5.4 | Product page card shows "Generic demo frame" and its checks |
| I-3 | The Try On Live button is published on the storefront | 5.5 + 6 | Overview step 3 says "Added to your live theme"; button visible on the product page |
| I-4 | A continuous camera feed opens on a real phone | 7.2 | Screen recording of at least 30 s |
| I-5 | The eyewear is tracked and rendered | 7.2–7.3 | Same recording + `?vm_debug=1` screenshot with fps and detect time |

## 1. One-time prerequisites

1. Install Node.js 22.12 or newer (`node --version`).
2. Enable pnpm: `corepack enable` (or `npm install -g pnpm@10`).
3. Install the Shopify CLI: `npm install -g @shopify/cli@latest`.
4. A Shopify Partner / Dev Dashboard account: <https://partners.shopify.com> (free).
5. A **development store**: Dev Dashboard → Stores → Add store → Development store. Choose to start with test data if offered.

## 2. Get the code running

```bash
git clone https://github.com/CElyousfi/VirtualMirror.git
cd VirtualMirror
pnpm install
pnpm check          # typecheck, lint, 73+ tests, build. Should end with no errors.
```

## 3. Link to a new Shopify app

```bash
pnpm config:link
```

- Choose **Create a new app**, name it `Virtual Mirror (dev)`.
- If asked about distribution, keep it as a development / custom app for now. **Do not choose public distribution on this dev app**; Shopify does not let you change it later. The public app is created separately at Milestone 6.
- The CLI writes `client_id` into `shopify.app.toml` (or creates `shopify.app.virtual-mirror-dev.toml`). Commit that change.

## 4. Start the app and install it

```bash
pnpm dev
```

- Log in when prompted and pick your development store.
- When the CLI is ready, press `p` to open the app. Approve the install. The permissions screen should list only: read and write products, write files.
- The app opens inside the Shopify admin on **Overview**.

## 5. Prepare one product

1. If your store has no eyewear, create a product in Shopify admin: title `Test Frame 52-18-145`, type `Eyeglasses`, any image, status Active.
2. In Virtual Mirror → **Overview** → **Sync catalog**.
3. **Products** → open the frame.
4. Click **Use generic demo frame (testing)**. Wait for it to finish.
5. Tick both "I accept" boxes (it is a generic frame, not your product) → **Approve** → **Show on store**.

## 6. Add the Try On Live button to the theme

1. **Overview** → step 3 → **Add it in the theme editor**. (Or: Online Store → Themes → Customize → a product page → Add block → Apps → Try On Live.)
2. Place it under the Add to cart button and **Save**.
3. Return to Overview: step 3 should now say "Added to your live theme".

## 7. Try it

1. Open the product page on your phone. Development stores are password protected: the password is in Online Store → Preferences.
2. Tap **Try On Live**, allow the camera. You should see yourself mirrored with the frame on your face.
3. Add `?vm_debug=1` to the product URL for the measurement overlay (frame rate, detection time, load times). Screenshot it.

## 8. Run the diagnostics and report back

Virtual Mirror → **Diagnostics** → **Run checks**. Copy the text box at the bottom.

Send back, for docs/IMPLEMENTATION_STATUS.md:

- the diagnostics text,
- one `?vm_debug=1` screenshot per phone (say which phone and browser),
- a short screen recording of the try-on,
- anything that failed, with the exact message.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `pnpm dev` stops at the database step | Run `pnpm prisma migrate deploy` once, then `pnpm dev` again |
| No Try On Live button on the product | The product is not published in the app (step 5), or the block is not added (step 6) |
| "Camera access was blocked" | Allow camera for the site in browser settings, then reload |
| Button appears but the mirror says the frame is unavailable | The Diagnostics CORS check will show why; send the results |
