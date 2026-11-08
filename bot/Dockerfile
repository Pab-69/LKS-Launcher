FROM node:22-alpine
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=80
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY config.json ./
COPY src ./src
USER node
CMD ["node", "src/index.js"]
