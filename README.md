# 3D Multiplayer Sword Fighting Game

A real-time multiplayer 3D sword fighting game with various character types and weapons.

## Features

- Real-time multiplayer using Socket.io
- Multiple character types with unique appearances
- Different sword types with unique stats and appearances
  - Broadsword (Knight): Balanced damage and speed
  - Katana (Samurai): Fast with medium damage, special "bleed" effect
  - Ninjato (Ninja): Fast attack, less damage, special "stealth" effect
  - Greatsword: High damage, slow speed, special "stun" effect
  - Rapier: Fast thrusting attacks with precision, special "critical" effect
  - Dual Daggers: Extremely fast, close range, special "bleed" effect
- Smooth character movement with acceleration/deceleration
- Weapon switching system (Q key)
- On-screen UI displaying controls and weapon stats
- Dynamic health and damage system

## Technical Implementation

- Frontend: Three.js for 3D rendering
- Backend: Node.js with Express
- Real-time communication: Socket.io
- Diagnostic tools: WebSocket server for monitoring

## Setup and Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser to `http://localhost:8989`

## Controls

- WASD: Move character
- Mouse: Look around
- Left Click: Attack
- Right Click: Block
- Q: Switch weapons
- R: Respawn (when defeated)

## Multiplayer System

The multiplayer system uses Socket.io to handle:
- Player registration and connection
- Position and state synchronization
- Combat and damage calculation
- Player defeats and respawns
- Disconnection handling

## Debug Information

A diagnostic WebSocket server runs on port 8990 for monitoring server status and player connections.

## Architecture

- `game.html`: Main game file with Three.js implementation
- `multiplayer.js`: Client-side multiplayer integration
- `server.js`: Server-side multiplayer logic
