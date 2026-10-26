# Browser worker: Playwright's official image already contains Chromium and its system libraries.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY worker/src ./src
EXPOSE 10000
CMD ["node", "src/server.mjs"]
