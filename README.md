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

## Project Structure

```
.
├── game.html         # Main game file (single-player version)
├── multiplayer.js    # Client-side multiplayer integration
├── server.js         # Server-side multiplayer logic
├── test-client.html  # Test client for debugging multiplayer
├── package.json      # Project dependencies
└── README.md         # Project documentation
```

## Technical Implementation

- **Frontend**: HTML5 Canvas/Three.js for 2D/3D rendering
- **Backend**: Node.js with Express
- **Real-time communication**: Socket.io
- **Multiplayer Architecture**: Client-Server model

## Prerequisites

- Node.js (v14+)
- NPM (v6+)
- A modern web browser (Chrome, Firefox, Safari, Edge)

## Setup and Installation

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

## Single-Player Mode

The game can be played in single-player mode by simply opening the `game.html` file in a web browser without running the server.

## Multiplayer Mode

To enable multiplayer functionality:

1. Start the server using `npm start`
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

1. Start the server with `npm start`
2. Open multiple browser windows pointing to `http://localhost:8989`
3. For debugging, access the test client at `http://localhost:8989/test-client.html`

### Diagnostic Tools

A diagnostic WebSocket server runs on port 8990 for monitoring:
- Server status
- Player connections
- Game state

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- Socket.io for the real-time communication library
- Three.js/HTML5 Canvas for rendering capabilities
- Our community of players and contributors
