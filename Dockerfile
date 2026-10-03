# Bot de Telegram de Primera Acción (proceso siempre encendido, BSC mainnet).
# docker build -t primera-accion .
# docker run -d --env-file .env -v primera-data:/app/data --restart unless-stopped primera-accion

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
