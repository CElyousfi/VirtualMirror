# Virtual Mirror: working rules

- Read docs/IMPLEMENTATION_STATUS.md first. Update it in the same commit as any change to what works.
- Never claim something works on Shopify, on a phone, or visually until it has run there. Use the evidence levels in IMPLEMENTATION_STATUS.md.
- No paid services, APIs or SDKs. Every dependency must have a commercial-use licence.
- Units: assets in metres, MediaPipe face space in centimetres. Convert only through `packages/contracts`.
- `packages/engine-*`, `packages/catalog`, `packages/contracts` must not import DOM, Shopify or React.
- An asset reaches shoppers only if Ready AND merchant-approved. Never substitute one variant's frame for another.
- Shopper copy says "see how they look", never "fit"; no prescription or medical claims.
- Small commits. Before pushing: `pnpm test && pnpm lint && pnpm build`. CI also runs Prisma, GraphQL schema validation and typecheck.
