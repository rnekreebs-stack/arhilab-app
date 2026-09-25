FROM node:22.22.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json eslint.config.mjs ./
COPY src ./src
RUN npm run build

FROM node:22.22.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S arhilab && adduser -S arhilab -G arhilab
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER arhilab
EXPOSE 3000
CMD ["node", "dist/server.js"]
