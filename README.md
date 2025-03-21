# 3D Multiplayer Sword Fighting Game

A real-time multiplayer 3D sword fighting game with various character types and weapons.

![Sword Fighting Game](https://placeholder-for-game-screenshot.png)

## Features

- **Real-time multiplayer** using Socket.io for seamless online gameplay
- **Multiple character types** with unique stats and abilities:
  - Knight: High defense, medium attack, low speed
  - Samurai: Balanced stats with medium defense, attack, and speed
  - Ninja: Low defense, medium attack, high speed
- **Various sword types** with unique properties:
  - Broadsword: High damage, slow speed
  - Katana: Good balance of damage and speed
  - Twin Daggers: Low damage, very high speed
  - *And more weapons to discover!*
- **Combat mechanics** including:
  - Basic attacks and blocks
  - Special character-specific abilities
  - Different attack patterns based on weapon type
- **Health and damage system** with visual feedback
- **Character customization** options
- **Responsive controls** for smooth gameplay
- **Scoring system** that tracks kills and deaths

## Project Structure

```
.
├── game.html         # Main game file (single-player version)
├── multiplayer.js    # Client-side multiplayer integration
├── server.js         # Server-side multiplayer logic
├── test-client.html  # Test client for debugging multiplayer
├── package.json      # Project dependencies
├── Dockerfile        # Docker container configuration
├── docker-compose.yml # Docker Compose configuration for local development
├── amplify.yml       # AWS Amplify build configuration
└── README.md         # Project documentation
```

## Technical Implementation

- **Frontend**: HTML5 Canvas/Three.js for 2D/3D rendering
- **Backend**: Node.js with Express
- **Real-time communication**: Socket.io
- **Multiplayer Architecture**: Client-Server model
- **Deployment**: Docker containers, AWS Amplify

### Multiplayer Synchronization

Our multiplayer system uses a sophisticated approach to ensure all players see consistent game state:

1. **Real-time Position Updates**: 
   - Client-side movement is processed locally first for responsiveness
   - Position data is sent to the server (x, y, z coordinates and rotation)
   - The server validates and broadcasts these updates to all other connected players
   - Updates include unique IDs and timestamps to handle out-of-order packets

2. **Optimized Data Transfer**:
   - Updates are only sent when significant movement occurs
   - Non-essential updates are throttled to reduce network traffic
   - State changes (attacking, blocking) are prioritized for immediate transmission

3. **Interpolation & Smoothing**:
   - Client-side interpolation creates smooth movement between update points
   - Adaptive interpolation factor adjusts based on network conditions
   - Prediction algorithms estimate player positions during packet loss

4. **Conflict Resolution**:
   - Server acts as the authority for resolving conflicts (like hit detection)
   - Timestamps are used to reconcile timing differences between clients
   - Server-side validation prevents cheating and ensures fair gameplay

5. **Player Tracking**:
   - Each player has a unique ID maintained across the session
   - Ghost player detection and cleanup handles disconnected players
   - Automatic reconnection handling preserves player state

This approach ensures minimal latency while maintaining game consistency across all players, even in challenging network conditions.

## Prerequisites

- Node.js (v14+)
- NPM (v6+)
- A modern web browser (Chrome, Firefox, Safari, Edge)
- Docker (for containerized deployment)

## Setup and Installation

### Standard Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/sword-fighting-game.git
cd sword-fighting-game
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:8989`

### Docker Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/sword-fighting-game.git
cd sword-fighting-game
```

2. Build and run with Docker Compose:
```bash
docker-compose up --build
```

3. Open your browser to `http://localhost:8989`

### Production Docker Build

```bash
# Build the Docker image
docker build -t sword-fighting-game .

# Run the container
docker run -p 8989:8989 sword-fighting-game
```

## Single-Player Mode

The game can be played in single-player mode by simply opening the `game.html` file in a web browser without running the server.

## Multiplayer Mode

To enable multiplayer functionality:

1. Start the server using `npm start` or Docker
2. Connect to the game through `http://localhost:8989`
3. Enter your player name and select your character/weapon
4. Join the battle with other connected players!

See `multiplayer_process.txt` for details on how the multiplayer system works.

## Controls

- **Movement**: WASD or Arrow Keys
- **Attack**: Space Bar
- **Special Attack**: Shift + Space
- **Jump**: W or Up Arrow
- **Switch Weapons**: Q key (when available)

## Development

### Testing Multiplayer Locally

You can test the multiplayer functionality locally by:

1. Start the server with `npm start` or `docker-compose up`
2. Open multiple browser windows pointing to `http://localhost:8989`
3. For debugging, access the test client at `http://localhost:8989/test-client.html`

### Diagnostic Tools

A diagnostic WebSocket server runs on port 8990 for monitoring:
- Server status
- Player connections
- Game state

## Deployment on AWS Amplify

This game is configured for easy deployment on AWS Amplify:

1. Connect your repository to AWS Amplify
2. Select "Deploy with existing configuration (amplify.yml)"
3. No additional configuration is needed - Amplify will use the amplify.yml file

### Environment Variables

The following environment variables can be set in AWS Amplify:

- `PORT`: Port number for the server (default: 8989)
- `DEBUG`: Set to true for detailed logging
- `MAX_PLAYERS`: Maximum number of concurrent players (default: 50)

## Building with AI Assistance

Creating this multiplayer game using an LLM (Large Language Model) like Claude would require:

### Tools Required:
1. **Code Generation Capabilities**: Access to tools that can directly create and edit code files
2. **Project Structure Understanding**: Tools to navigate and understand the codebase structure
3. **Debugging Interface**: Ability to run code and review output/errors
4. **Documentation Access**: Reference materials for libraries like Socket.io, Three.js
5. **Interactive Refinement**: Methods to iteratively improve code based on testing results

### Development Process:
1. **Initial Design**: Define data structures for player state, movement, and synchronization
2. **Socket.io Integration**: Establish real-time communication between clients and server
3. **State Management**: Implement robust client and server state tracking
4. **Network Optimization**: Apply bandwidth reduction techniques for efficiency
5. **Edge Case Handling**: Address disconnections, latency, and synchronization conflicts
6. **Testing & Refinement**: Iterative improvement based on multi-client testing

The complete process is documented in `multiplayer_process.txt`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- Socket.io for the real-time communication library
- Three.js/HTML5 Canvas for rendering capabilities
- Our community of players and contributors
