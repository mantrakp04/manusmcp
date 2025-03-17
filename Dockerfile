# Custom Flowise Image

# Stage 1: Build stage (node)
FROM node:20-alpine AS nodebuild

USER root

# Install dependencies
RUN apk add --no-cache chromium git python3 py3-pip make g++ build-base cairo-dev pango-dev curl \
    python3-dev openblas-dev lapack-dev gfortran pkgconfig

# Install latest Flowise globally (specific version can be set: flowise@1.0.0)
RUN npm install -g -y bun && bun install -g -y flowise@latest

WORKDIR /mnt/data/.runtime

COPY .runtime .

# Install dependencies
RUN python -m venv .venv && \
    .venv/bin/pip install --upgrade pip setuptools wheel && \
    .venv/bin/pip install -r requirements.txt && \
    bun install

# Set the environment variable for Puppeteer to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /mnt/data
ENTRYPOINT ["flowise", "start"]