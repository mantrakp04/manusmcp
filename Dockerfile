# Custom Flowise Image

# Stage 1: Build stage (node)
FROM node:20-alpine AS nodebuild

USER root

WORKDIR /mnt/data/.runtime

COPY .runtime .

# Install dependencies
RUN apk add --no-cache chromium git python3 py3-pip make g++ build-base cairo-dev pango-dev curl \
    python3-dev openblas-dev lapack-dev gfortran pkgconfig && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    source $HOME/.local/bin/env && \
    uv sync && \
    npm install -g -y bun && \
    bun install -g -y flowise@latest

# Set the environment variable for Puppeteer to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /mnt/data
CMD source .runtime/.venv/bin/activate && bunx flowise@latest start