# Virtual Mirror

Live 3D eyewear try-on for Shopify stores. A merchant installs the app, prepares eyewear products as 3D assets, approves them, and shoppers see the frames on their own face through the camera, directly on the product page.

Status: Milestone 1 in progress. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for what is implemented, tested and untested.

## Repository layout

| Path | What it is |
| --- | --- |
| `app/` | Shopify embedded admin app (React Router, Polaris web components, Prisma) |
| `extensions/virtual-mirror/` | Theme app extension: the "Try On Live" block and widget assets |
| `packages/contracts` | Units, coordinate spaces, schemas, `PreparationMethod` interface |
| `packages/catalog` | Shopify product mapping and eyewear detection (pure functions) |
| `packages/engine-geometry` | GLB generation and validation (runtime-neutral TypeScript) |
| `packages/widget` | Shopper-side camera, MediaPipe tracking and Three.js rendering |
| `docs/` | Specification, architecture, decisions and status |

## Commands

```bash
pnpm install          # install everything
pnpm test             # unit tests (vitest)
pnpm typecheck        # TypeScript across app and packages
pnpm lint             # ESLint
pnpm build            # build widget bundle + app
pnpm dev              # build widget, then `shopify app dev` (needs your Shopify Partner login)
pnpm check            # typecheck + lint + test + build
pnpm qa               # internal QA Lab (docs/VISUAL_QA.md)
pnpm qa:phone         # QA Lab over HTTPS for a phone on the same Wi-Fi
```

First-time Shopify setup is in [docs/SETUP.md](docs/SETUP.md).
