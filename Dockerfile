# Production image (untested; production hosting is not yet chosen).
FROM node:22-alpine
RUN apk add --no-cache openssl && corepack enable

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production

COPY . .
# Build needs dev dependencies (vite, typescript); prune them afterwards.
RUN NODE_ENV=development pnpm install --frozen-lockfile \
  && pnpm build \
  && pnpm prune --prod

CMD ["pnpm", "docker-start"]
