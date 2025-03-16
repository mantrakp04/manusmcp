#!/bin/bash

# Check if --docker argument is present
if [[ "$*" == *"--docker"* ]]; then
    echo "Running in Docker mode..."
    # Build the Docker image
    docker build -t flowise-app .
    
    # Run the Docker container
    docker run -p 3000:3000 flowise-app
else
    # Install bun
    npm install -g bun

    # Install dependencies
    cd .runtime
    bun install

    cd ..

    # Run flowise
    bunx flowise@latest start
fi