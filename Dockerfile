FROM node:20-bullseye-slim

# Install system dependencies for Playwright and Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Pin the browser download location so it is found regardless of the runtime
# user or an unset HOME (systemd/pm2 commonly drop HOME, which is why Playwright
# ends up looking in the wrong ~/.cache/ms-playwright directory).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Set working directory
WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install dependencies
RUN npm ci

# Install Playwright browser dependencies (specifically Chromium) into $PLAYWRIGHT_BROWSERS_PATH
RUN npx playwright install --with-deps chromium \
    && chmod -R 0755 /ms-playwright

# Copy application code
COPY . .

# Build Vite frontend and esbuild server
RUN npm run build

# Expose server port
EXPOSE 3000

# Container-level health check hitting the public health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Start Express server. Render's dedicated worker service overrides this with
# `npm run worker`; the shared build already contains dist/worker.cjs.
CMD ["npm", "start"]
