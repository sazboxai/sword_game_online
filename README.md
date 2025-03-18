# 3D Multiplayer Sword Fighting Game

A real-time multiplayer 3D sword fighting game built with Three.js, Socket.io, and Express.

## Features

- Real-time multiplayer functionality with Socket.io
- 3D graphics with Three.js
- Different character types (Knight, Ninja, Samurai)
- Multiple weapon types with unique stats:
  - Broadsword: Balanced damage and speed
  - Katana: Fast with medium damage, special "bleed" effect
  - Ninjato: Fast attack, less damage, special "stealth" effect
  - Greatsword: High damage, slow speed, special "stun" effect
  - Rapier: Fast thrusting attacks with precision, special "critical" effect
  - Dual Daggers: Extremely fast, close range, special "bleed" effect
- Dynamic combat system with attacks, blocking, and dodging
- Environmental collision detection
- Player respawn system
- Player name tags and health indicators
- In-game chat (coming soon)

## How to Play

1. Clone the repository
2. Install the dependencies with `npm install`
3. Start the server with `npm start`
4. Open http://localhost:3000 in your browser
5. Enter your name and select a character
6. Use WASD to move, space to sprint, left-click to attack, right-click to block
7. Press Q to switch weapons

## Controls

- WASD: Move
- Mouse: Look around
- Left Mouse Button: Attack
- Right Mouse Button: Block
- Space: Sprint
- Q: Switch weapons
- R: Respawn (after being defeated)

## Technologies Used

- Three.js for 3D rendering
- Socket.io for real-time multiplayer communication
- Express for the web server
- Node.js for the backend

## Development

To set up the development environment:

```bash
git clone https://github.com/yourusername/multiplayer-sword-fighting-game.git
cd multiplayer-sword-fighting-game
npm install
npm start
```

## License

MIT
