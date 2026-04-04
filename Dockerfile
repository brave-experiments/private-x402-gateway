FROM node:24-slim AS base
WORKDIR /app

FROM base AS install
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/relay/package.json ./packages/relay/
COPY packages/facilitator/package.json ./packages/facilitator/
COPY packages/gateway/package.json ./packages/gateway/
RUN npm ci

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.base.json ./
COPY turbo.json ./
COPY packages/shared/ ./packages/shared/
RUN npm run build --workspace=packages/shared
COPY packages/relay/ ./packages/relay/
COPY packages/facilitator/ ./packages/facilitator/
COPY packages/gateway/ ./packages/gateway/
RUN npm run build --workspace=packages/relay
RUN npm run build --workspace=packages/facilitator
RUN npm run build --workspace=packages/gateway

FROM base AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/relay/dist ./packages/relay/dist
COPY --from=build /app/packages/relay/package.json ./packages/relay/
COPY --from=build /app/packages/facilitator/dist ./packages/facilitator/dist
COPY --from=build /app/packages/facilitator/package.json ./packages/facilitator/
COPY --from=build /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=build /app/packages/gateway/package.json ./packages/gateway/
RUN mkdir -p /app/.keys
