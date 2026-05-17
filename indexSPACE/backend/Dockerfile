FROM oven/bun:1.3.1 AS runtime

WORKDIR /app

COPY indexspace/backend/package.json /app/indexspace/backend/package.json
COPY indexspace/backend/src /app/indexspace/backend/src
COPY indexspace/shared/package.json /app/indexspace/shared/package.json
COPY indexspace/shared/src /app/indexspace/shared/src
COPY packages/core/package.json /app/packages/core/package.json
COPY packages/core/src /app/packages/core/src

WORKDIR /app/indexspace/backend

RUN bun install --production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

CMD ["bun", "run", "src/index.ts"]
