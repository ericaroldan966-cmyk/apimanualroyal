FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY schema.sql ./
COPY migrations ./migrations
COPY src ./src
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/local-server.ts"]
