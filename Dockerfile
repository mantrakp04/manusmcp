# Custom Flowise Image

# Stage 1: Build stage (node)
FROM node:20-alpine AS nodebuild

USER root

WORKDIR /mnt/data
WORKDIR /home/.runtime

COPY .runtime .

# Install dependencies
RUN apk add --no-cache chromium git python3 py3-pip make g++ build-base cairo-dev pango-dev curl \
    python3-dev openblas-dev lapack-dev gfortran pkgconfig && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    source $HOME/.local/bin/env && \
    # takes forever for some reason
    # uv sync && \
    npm install -g -y bun

WORKDIR /home
CMD source .runtime/.venv/bin/activate && bunx -y supergateway --stdio "bun .runtime/index.ts"