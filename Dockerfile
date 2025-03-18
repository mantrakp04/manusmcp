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
    libmagic-dev \
    poppler-utils \
    tesseract-ocr \
    libreoffice \
    pandoc \
    && rm -rf /var/lib/apt/lists/* && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash && \
    . $NVM_DIR/nvm.sh && \
    nvm install $NODE_VERSION && \
    nvm use $NODE_VERSION && \
    nvm alias default $NODE_VERSION && \
    . $NVM_DIR/nvm.sh && \
    npm install -y -g bun

WORKDIR /app/.runtime
RUN git clone https://github.com/Unstructured-IO/unstructured-api.git && \
    cd unstructured-api && \
    python3 -m venv .venv && \
    bash -c ". .venv/bin/activate && pip install --upgrade pip && make install" && \
    cd ..

WORKDIR /app/.runtime
COPY . .

RUN . $NVM_DIR/nvm.sh && uv sync && bunx playwright install chrome --with-deps

EXPOSE 8000
EXPOSE 4000
EXPOSE 3000
EXPOSE 8080

WORKDIR /app
CMD bash .runtime/start.sh

# docker build -t manusmcp .
# docker run -p 8000:8000 -p 4000:4000 -p 8080:8080 --env-file .env -v $(pwd)/.run1:/app manusmcp