FROM node:22-slim

# Install required dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY .runtime/ .runtime/
COPY start.sh .

# Make start.sh executable
RUN chmod +x start.sh

# Expose the default Flowise port
EXPOSE 3000

# Set the entry point to the start.sh script
ENTRYPOINT ["/app/start.sh"] 