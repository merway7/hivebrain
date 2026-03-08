FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/db/seed.js ./db/seed.js
COPY --from=build /app/db/schema.sql ./db/schema.sql
COPY --from=build /app/db/starter-pack.json ./db/starter-pack.json

# Persistent volume mount point for SQLite
RUN mkdir -p /data/db

ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production
ENV HIVEBRAIN_MODE=private
ENV HIVEBRAIN_DB_PATH=/data/db/hivebrain.db

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
