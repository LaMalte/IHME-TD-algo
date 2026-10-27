FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG BASE_PATH=/
RUN npm run build -- --base="${BASE_PATH}"

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 COOKIE_SECURE=true
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public/logos ./public/logos
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
