# Browser worker: Playwright's official image already contains Chromium and its system libraries.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY worker/src ./src
# Copies of careers-site forms for the pilot self-test (made-up data only).
COPY worker/test/fixtures ./fixtures
# Run as the image's unprivileged user, not root.
RUN chown -R pwuser:pwuser /app
USER pwuser
EXPOSE 10000
CMD ["node", "src/server.mjs"]
