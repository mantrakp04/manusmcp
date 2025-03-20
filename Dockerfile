FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV NVM_DIR=/root/.nvm
ENV NODE_VERSION=22

RUN apt-get update && apt-get install -y \
    build-essential \
    make \
    gcc \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/* && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash && \
    . $NVM_DIR/nvm.sh && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    nvm alias default $NODE_VERSION && \
    . $NVM_DIR/nvm.sh && \
    npm install -y -g bun

WORKDIR /app/.runtime
COPY . .

RUN . $NVM_DIR/nvm.sh && uv sync && bunx playwright install chrome --with-deps

EXPOSE 8000

WORKDIR /app
CMD uv run --project ./.runtime manusmcp

# docker build -t manusmcp .
# docker run -p 8000:8000 manusmcp
