FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci --prefer-offline --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner

ARG APP_BUILD_REVISION=v1.1.8

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV TZ=Asia/Shanghai
ENV APP_BUILD_REVISION=${APP_BUILD_REVISION}

LABEL cn.badminton.build-revision=${APP_BUILD_REVISION}

WORKDIR /app

COPY --from=builder --chown=node:node /app/dist/standalone ./
# Vinext's standalone tracer currently omits React. Copy only that missing
# runtime package instead of the complete production dependency tree.
COPY --from=builder --chown=node:node /app/node_modules/react/ /app/node_modules/react/
RUN test -f /app/node_modules/react/package.json
RUN node --input-type=module -e "await import('react'); console.log('Container React runtime verified')"

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
