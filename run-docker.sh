#!/bin/bash

# Print banner
echo "================================="
echo "  Multiplayer Sword Fighting Game"
echo "================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Build and run the game
echo "Starting the game server with Docker..."
docker-compose up -d

# Check if container started successfully
if [ $? -eq 0 ]; then
    echo ""
    echo "Game server started successfully!"
    echo ""
    echo "Open your browser and navigate to:"
    echo "http://localhost:8989"
    echo ""
    echo "To view server logs:"
    echo "docker-compose logs -f"
    echo ""
    echo "To stop the server:"
    echo "docker-compose down"
    echo ""
else
    echo "Failed to start the game server."
    exit 1
fi 