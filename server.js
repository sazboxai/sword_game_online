const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Track connected players
const players = {};
const games = {};

// Socket.io connection handler
io.on('connection', (socket) => {
    console.log(`New player connected: ${socket.id}`);
    
    // Handle player joining
    socket.on('playerJoin', (playerData) => {
        console.log(`Player joined: ${playerData.name}, type: ${playerData.characterType}`);
        
        // Store player data
        players[socket.id] = {
            id: socket.id,
            name: playerData.name,
            characterType: playerData.characterType,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            health: 100,
            swordType: playerData.swordType || 'broadsword',
            isAttacking: false,
            isBlocking: false
        };
        
        // Broadcast new player to all other players
        socket.broadcast.emit('playerJoined', players[socket.id]);
        
        // Send existing players to the new player
        Object.keys(players).forEach(playerId => {
            if (playerId !== socket.id) {
                socket.emit('playerJoined', players[playerId]);
            }
        });
    });
    
    // Handle player movement updates
    socket.on('playerUpdate', (data) => {
        // Update player data
        if (players[socket.id]) {
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            players[socket.id].isAttacking = data.isAttacking;
            players[socket.id].isBlocking = data.isBlocking;
            players[socket.id].swordType = data.swordType;
            
            // Broadcast player update to all other players
            socket.broadcast.emit('playerUpdated', {
                id: socket.id,
                ...data
            });
        }
    });
    
    // Handle player attacks
    socket.on('playerAttack', (data) => {
        // Broadcast attack to all other players
        socket.broadcast.emit('playerAttacked', {
            id: socket.id,
            position: data.position,
            direction: data.direction,
            swordType: data.swordType,
            damage: data.damage
        });
    });
    
    // Handle damage
    socket.on('playerDamaged', (data) => {
        const { targetId, damage } = data;
        
        if (players[targetId]) {
            players[targetId].health -= damage;
            
            // Broadcast damage to all players
            io.emit('healthUpdate', {
                id: targetId,
                health: players[targetId].health
            });
            
            // Check for player defeat
            if (players[targetId].health <= 0) {
                io.emit('playerDefeated', { id: targetId });
            }
        }
    });
    
    // Handle player respawn
    socket.on('playerRespawn', (data) => {
        if (!players[socket.id]) return;
        
        // Update player data
        players[socket.id].position = data.position;
        players[socket.id].health = 100; // Reset health on respawn
        
        // Broadcast respawn to all other players
        socket.broadcast.emit('playerRespawned', {
            id: socket.id,
            position: data.position
        });
        
        console.log(`Player ${socket.id} respawned at position:`, data.position);
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        // Broadcast player left to all clients
        io.emit('playerLeft', { id: socket.id });
        
        // Remove player from players object
        delete players[socket.id];
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
