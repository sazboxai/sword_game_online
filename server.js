// Multiplayer Sword Game Server
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws'); // Native WebSocket server for diagnostics

// Create Express app and HTTP server
const app = express();

// Enable CORS for all routes
app.use(cors());

const server = http.createServer(app);

// Initialize Socket.io server with improved configuration
const io = socketIO(server, {
    cors: {
        // Allow all origins during development for maximum compatibility
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: false
    },
    // Path configuration to ensure compatibility
    path: '/socket.io/', // Explicitly set the default path
    
    // Transport configuration
    transports: ['websocket', 'polling'], // Try WebSocket first, fall back to polling
    
    // Connection management
    pingTimeout: 10000,                 // 10 seconds ping timeout
    pingInterval: 5000,                 // 5 seconds ping interval
    upgradeTimeout: 10000,              // 10 seconds for upgrade timeout
    
    // Connection parameters
    maxHttpBufferSize: 1e8,             // Increased buffer size for large messages (100MB)
    
    // Client options
    serveClient: true,                  // Serve Socket.io client files from server
    connectTimeout: 45000,              // 45 seconds connection timeout
    
    // Version compatibility
    allowEIO3: true,                    // Allow Engine.IO v3 client connections
    
    // Custom settings
    destroyUpgrade: true,               // Destroy upgraded HTTP requests
    perMessageDeflate: {                // Enable WebSocket per-message deflate
        threshold: 1024                 // Only compress messages larger than 1KB
    }
});

// Add a connection event handler that logs all connection attempts
io.engine.on('connection', (socket) => {
    console.log(`\n[ENGINE] New raw connection attempt from ${socket.remoteAddress}`);
});

// Log Socket.io server configuration for debugging
console.log('Socket.io server configuration:');
console.log('- Transports:', io.engine.opts.transports);
console.log('- CORS origin:', io.engine.opts.cors.origin);
console.log('- Ping timeout:', io.engine.opts.pingTimeout);
console.log('- Ping interval:', io.engine.opts.pingInterval);
console.log('- Serving client:', io.engine.opts.serveClient ? 'Yes' : 'No');

// Add additional debug indicators
console.log('\n======== DEBUG MODE ENABLED ========');
console.log('Server will log all socket events');
console.log('====================================\n');

// Add detailed Socket.io connection logging
io.use((socket, next) => {
    console.log(`\n[MIDDLEWARE] New connection attempt from ${socket.handshake.address}`);
    console.log(`Transport: ${socket.conn.transport.name}`);
    console.log(`Protocol: ${socket.conn.protocol}`);
    console.log(`Connection ID: ${socket.id}`);
    console.log(`Query params:`, socket.handshake.query);
    
    // Allow the connection to proceed
    next();
});

// Add a specific handler for polling transport errors which are common
io.engine.on('connection_error', (err) => {
    console.error(`\n[ENGINE ERROR] ${err.code}: ${err.message}`);
    console.error(err.stack);
});

// Serve static files from current directory
app.use(express.static(__dirname));

// Add specific route for Socket.io client library
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.js'));
});

// Serve the game HTML file on the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});

// Health check endpoint
app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        connections: Object.keys(io.sockets.sockets).length,
        players: Object.keys(players).length,
        registeredPlayers: Object.keys(players).filter(id => players[id].fullyRegistered).length,
        uptime: Math.floor(process.uptime())
    });
});

// Track connected players
const players = {};
const games = {};

// Helper function: Send existing players to a newly connected client
function sendExistingPlayersToClient(socket) {
    console.log(`===== SENDING EXISTING PLAYERS TO ${socket.id} =====`);
    
    // Create a list of other players (not including the requesting player)
    const otherPlayers = {};
    
    // Count how many fully registered players we're sending
    let fullyRegisteredCount = 0;
    
    // Loop through all players
    for (const id in players) {
        // Skip sending the requesting player their own data
        if (id === socket.id) {
            console.log(`Skipping sending ${id} (requesting player) to themselves`);
            continue;
        }
        
        // Only include fully registered players
        if (players[id].fullyRegistered) {
            otherPlayers[id] = { ...players[id] };
            fullyRegisteredCount++;
            console.log(`Including player ${players[id].name} (${id})`);
        } else {
            console.log(`Skipping unregistered player ${id}`);
        }
    }
    
    // Send the list to the client
    console.log(`Sending ${fullyRegisteredCount} players to ${socket.id}`);
    socket.emit('existingPlayers', otherPlayers);
    console.log(`============================`);
}

// Log that the Socket.io server is ready
console.log('Socket.io server initialized and ready for connections');

// Add interval to log player count
setInterval(() => {
    const connectedSockets = Object.keys(io.sockets.sockets).length;
    const registeredPlayers = Object.keys(players).filter(id => players[id].fullyRegistered).length;
    console.log(`\n[STATUS] Connected clients: ${connectedSockets}, Registered players: ${registeredPlayers}`);
    if (registeredPlayers > 0) {
        console.log(`[STATUS] Players:`);
        Object.keys(players).forEach(id => {
            const player = players[id];
            if (player.fullyRegistered) {
                console.log(`  - ${player.name} (${id}): ${player.characterType} with ${player.swordType}`);
            }
        });
    }
    console.log(`[STATUS] Socket.io connections: ${io.engine.clientsCount}`);
}, 5000);

// Socket.io connection handler
io.on('connection', (socket) => {
    console.log(`\n===== NEW PLAYER CONNECTED =====`);
    console.log(`Socket ID: ${socket.id}`);
    console.log(`Client IP: ${socket.handshake.address}`);
    console.log(`Transport: ${socket.conn.transport.name}`);
    console.log(`User Agent: ${socket.handshake.headers['user-agent']}`);
    
    // Create a basic player record immediately on connection
    players[socket.id] = {
        id: socket.id,
        name: `Player_${socket.id.substring(0, 5)}`,
        joinedAt: Date.now(),
        fullyRegistered: false,
        characterType: 'knight', // Default character
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        health: 100
    };
    
    // Handle test events from client
    socket.on('test', (data) => {
        console.log(`\n===== TEST MESSAGE FROM CLIENT ${socket.id} =====`);
        console.log(data);
        
        // Send a response back to acknowledge receipt
        socket.emit('testResponse', { 
            message: 'Server received your test message!',
            receivedAt: new Date().toISOString(),
            clientsConnected: Object.keys(io.sockets.sockets).length,
            playersRegistered: Object.keys(players).length
        });
    });
    
    console.log(`Created initial player record for ${socket.id}`);
    console.log(`Current player count: ${Object.keys(players).length}`);
    console.log(`============================`);
    
    // Log all socket events (for debugging)
    const originalOn = socket.on;
    socket.on = function(event, callback) {
        if (event !== 'ping' && event !== 'pong') { // Skip logging frequent ping/pong events
            const wrappedCallback = function(...args) {
                console.log(`\n[EVENT] Client ${socket.id} emitted '${event}' with data:`, args[0]);
                return callback.apply(this, args);
            };
            return originalOn.call(this, event, wrappedCallback);
        } else {
            return originalOn.call(this, event, callback);
        }
    };
    
    // Handle explicit player registration
    socket.on('playerJoin', (playerData) => {
        console.log(`\n===== PLAYER JOIN EVENT =====`);
        console.log(`Socket ID: ${socket.id}`);
        console.log(`Player Name: ${playerData.name}`);
        console.log(`Character Type: ${playerData.characterType}`);
        console.log(`Sword Type: ${playerData.swordType}`);
        console.log(`Initial Position:`, playerData.position);
        
        // Validate and sanitize player name
        let playerName = playerData.name;
        if (!playerName || playerName.trim() === '') {
            playerName = `Player_${socket.id.substring(0, 5)}`;
            console.log(`Using default name for player ${socket.id} because name was empty or invalid`);
        } else {
            playerName = playerName.trim();
            console.log(`Using provided name '${playerName}' for player ${socket.id}`);
        }
        
        // Update existing player data
        players[socket.id] = {
            ...players[socket.id],
            id: socket.id,
            name: playerName,
            characterType: playerData.characterType || 'knight',
            swordType: playerData.swordType || 'broadsword',
            fullyRegistered: true,
            lastActivity: Date.now()
        };
        
        // Update position if provided
        if (playerData.position && typeof playerData.position === 'object') {
            // Validate position data to prevent NaN or undefined values
            players[socket.id].position = {
                x: typeof playerData.position.x === 'number' ? playerData.position.x : 0,
                y: typeof playerData.position.y === 'number' ? playerData.position.y : 0,
                z: typeof playerData.position.z === 'number' ? playerData.position.z : 0
            };
            console.log(`Updated player position:`, players[socket.id].position);
        }
        
        // Notify all other clients about this player joining
        console.log(`Broadcasting playerJoined event for ${socket.id} (${players[socket.id].name})`);
        socket.broadcast.emit('playerJoined', players[socket.id]);
        
        // Send existing players to the newly joined player
        console.log(`Sending existing players to ${socket.id} (${players[socket.id].name})`);
        sendExistingPlayersToClient(socket);
        
        // Also send a specific notification to test client visibility
        socket.emit('debugMessage', {
            message: `You are registered as ${players[socket.id].name} (${socket.id})`,
            players: Object.keys(players).filter(id => id !== socket.id).map(id => players[id].name)
        });
        
        // Log player counts for debugging
        console.log(`Total players: ${Object.keys(players).length}`);
        console.log(`Fully registered players: ${Object.keys(players).filter(id => players[id].fullyRegistered).length}`);
        console.log(`Current players:`);
        Object.keys(players).forEach(id => {
            if (players[id].fullyRegistered) {
                console.log(`  - ${players[id].name} (${id}): ${players[id].characterType} with ${players[id].swordType}`);
            }
        });
        console.log(`===========================`);
    });
    
    // Handle request for existing players
    socket.on('requestExistingPlayers', () => {
        console.log(`Player ${socket.id} requested existing players list`);
        sendExistingPlayersToClient(socket);
    });
    
    // Handle ping requests (for testing connection)
    socket.on('ping', (data, callback) => {
        console.log(`Ping from ${socket.id}, timestamp: ${data.timestamp}`);
        if (typeof callback === 'function') {
            callback({
                status: 'success',
                timestamp: Date.now(),
                clientTimestamp: data.timestamp,
                playerId: socket.id,
                ping: Date.now() - data.timestamp
            });
        }
    });
    
    // Handle player movement updates
    socket.on('playerUpdate', (data) => {
        // Update player data
        if (!players[socket.id]) {
            console.log(`Received update from unregistered player ${socket.id}`);
            
            // Auto-create player if it doesn't exist yet
            players[socket.id] = {
                id: socket.id,
                name: `Player_${socket.id.substring(0, 5)}`,
                characterType: data.characterType || 'knight',
                position: data.position || { x: 0, y: 0, z: 0 },
                rotation: data.rotation || 0,
                health: 100,
                swordType: data.swordType || 'broadsword',
                isAttacking: data.isAttacking || false,
                isBlocking: data.isBlocking || false,
                joinedAt: Date.now(),
                fullyRegistered: false, // Not fully registered yet
                autoRegistrationAttempted: true
            };
            console.log(`Auto-created player record for ${socket.id}`);
            return;
        }
        
        // Update player's last activity timestamp
        players[socket.id].lastActivity = Date.now();
        
        // Check if player should be auto-registered after receiving position updates
        if (!players[socket.id].fullyRegistered && !players[socket.id].autoRegistrationRejected) {
            if (!players[socket.id].autoRegistrationAttempted) {
                console.log(`Auto-registering player ${socket.id} after position update`);
                players[socket.id].fullyRegistered = true;
                players[socket.id].autoRegistrationAttempted = true;
                
                // Broadcast that this player is now available
                socket.broadcast.emit('playerJoined', {
                    ...players[socket.id],
                    _autoRegistered: true
                });
                
                // Also send existing players to this newly registered player
                sendExistingPlayersToClient(socket);
            }
        }
        
        // Store previous position for debugging
        const prevPos = players[socket.id].position ? {...players[socket.id].position} : null;
        
        // Ensure position is valid before updating
        if (data.position && typeof data.position === 'object') {
            // Validate each coordinate
            const x = typeof data.position.x === 'number' ? data.position.x : players[socket.id].position?.x || 0;
            const y = typeof data.position.y === 'number' ? data.position.y : players[socket.id].position?.y || 0;
            const z = typeof data.position.z === 'number' ? data.position.z : players[socket.id].position?.z || 0;
            
            // Check for invalid (NaN/Infinity) values
            if (isNaN(x) || isNaN(y) || isNaN(z) || 
                !isFinite(x) || !isFinite(y) || !isFinite(z)) {
                console.error(`Invalid position data from ${socket.id}:`, data.position);
                return; // Skip update
            }
            
            // Update player position
            players[socket.id].position = { x, y, z };
            
            // Log position change (only if significant movement occurred)
            if (prevPos && (
                Math.abs(prevPos.x - x) > 0.5 ||
                Math.abs(prevPos.z - z) > 0.5
            )) {
                console.log(`Player ${players[socket.id].name} (${socket.id}) moved from:`, 
                    `(${prevPos.x.toFixed(2)}, ${prevPos.y.toFixed(2)}, ${prevPos.z.toFixed(2)})`,
                    'to:',
                    `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
            }
        }
        
        // Update other properties with validation
        if (typeof data.rotation === 'number') {
            players[socket.id].rotation = data.rotation;
        }
        if (typeof data.isAttacking === 'boolean') {
            players[socket.id].isAttacking = data.isAttacking;
        }
        if (typeof data.isBlocking === 'boolean') {
            players[socket.id].isBlocking = data.isBlocking;
        }
        if (data.swordType && typeof data.swordType === 'string') {
            players[socket.id].swordType = data.swordType;
        }
        
        // Update player name if provided
        if (data.name && typeof data.name === 'string' && data.name.trim() !== '') {
            // Only update if name changed
            if (players[socket.id].name !== data.name) {
                console.log(`Player ${socket.id} name changed from '${players[socket.id].name}' to '${data.name}'`);
                players[socket.id].name = data.name;
            }
        }
        
        // Create a timestamp to ensure unique updates
        const updateId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
        
        // Broadcast player update to all other players
        socket.broadcast.emit('playerUpdated', {
            id: socket.id,
            position: players[socket.id].position,
            rotation: players[socket.id].rotation,
            isAttacking: players[socket.id].isAttacking,
            isBlocking: players[socket.id].isBlocking,
            swordType: players[socket.id].swordType,
            updateId: updateId // Ensure each update is treated as unique
        });
    });
    
    // Handle player attacks
    socket.on('playerAttack', (data) => {
        try {
            console.log(`[EVENT] Player ${socket.id} attacked with data:`, data);
            
            // Get current player data from the players object
            const currentPlayerData = players[socket.id] || {};
            
            // Check if data is null or undefined and construct attack data with fallbacks
            const attackData = {
                id: socket.id,
                // Use default values or current player data if data is null
                position: data?.position || currentPlayerData?.position || { x: 0, y: 0, z: 0 },
                direction: data?.direction || currentPlayerData?.direction || { x: 0, y: 0, z: 1 },
                swordType: data?.swordType || currentPlayerData?.swordType || 'broadsword',
                damage: data?.damage || calculateDamageFromSwordType(data?.swordType || currentPlayerData?.swordType),
                hitPlayers: Array.isArray(data?.hitPlayers) ? data.hitPlayers : []
            };
            
            // Store the sword type for future reference if it changed
            if (attackData.swordType && players[socket.id] && 
                attackData.swordType !== players[socket.id].swordType) {
                players[socket.id].swordType = attackData.swordType;
                console.log(`[SERVER] Player ${socket.id} switched sword to ${attackData.swordType}`);
            }
            
            // Log attack details for debugging
            console.log(`[SERVER] Player ${socket.id} attacked with ${attackData.swordType} sword`);
            if (attackData.hitPlayers.length > 0) {
                console.log(`[SERVER] Attack hit players: ${attackData.hitPlayers.join(', ')}`);
            }
            
            // Broadcast attack to all other players
            socket.broadcast.emit('playerAttacked', attackData);
        } catch (error) {
            console.error(`[ERROR] Error handling player attack: ${error.message}`);
        }
    });
    
    // Helper function to calculate damage based on sword type
    function calculateDamageFromSwordType(swordType) {
        switch(swordType) {
            case 'broadsword': return 15;
            case 'katana': return 12;
            case 'ninjato': return 10;
            case 'greatsword': return 20;
            case 'rapier': return 12;
            case 'dualdaggers': return 8;
            default: return 10; // Default damage
        }
    }
    
    // Handle damage
    socket.on('playerDamaged', (data) => {
        const { targetId, damage } = data;
        
        if (players[targetId]) {
            players[targetId].health -= damage;
            
            // Broadcast health update to all players
            io.emit('healthUpdate', {
                id: targetId,
                health: players[targetId].health
            });
            
            // Check if player is defeated
            if (players[targetId].health <= 0) {
                // Reset health to 0 for consistency
                players[targetId].health = 0;
                
                // Broadcast player defeat
                io.emit('playerDefeated', { id: targetId });
            }
        }
    });
    
    // Handle player respawn
    socket.on('playerRespawn', (data) => {
        if (players[socket.id]) {
            // Reset player health
            players[socket.id].health = 100;
            
            // Update player position if provided
            if (data.position) {
                players[socket.id].position = data.position;
            }
            
            // Broadcast player respawn to all players
            io.emit('playerRespawned', {
                id: socket.id,
                position: players[socket.id].position
            });
        }
    });
    
    // Handle chat messages
    socket.on('chatMessage', (message) => {
        // Add sender information
        const messageData = {
            sender: players[socket.id]?.name || 'Unknown',
            senderId: socket.id,
            message: message,
            timestamp: Date.now()
        };
        
        // Broadcast message to all players
        io.emit('chatMessage', messageData);
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
        console.log(`\n===== PLAYER DISCONNECTED =====`);
        console.log(`Socket ID: ${socket.id}`);
        console.log(`Reason: ${reason}`);
        
        if (players[socket.id]) {
            // Get player name before removing
            const playerName = players[socket.id].name;
            const joinedAt = players[socket.id].joinedAt;
            const lastPosition = players[socket.id].position;
            const timeInGame = Date.now() - joinedAt;
            const wasFullyRegistered = players[socket.id].fullyRegistered;
            
            // Notify other players about this player leaving
            socket.broadcast.emit('playerLeft', {
                id: socket.id,
                name: playerName,
                lastPosition: lastPosition,
                timeInGame: timeInGame
            });
            console.log(`Broadcast playerLeft event for ${socket.id} (${playerName})`);
            
            // Remove player from players object
            delete players[socket.id];
            
            // Log detailed player information
            console.log(`Player ${playerName} (${socket.id}) disconnected`);
            console.log(`Time in game: ${Math.floor(timeInGame / 1000)} seconds`);
            console.log(`Was fully registered: ${wasFullyRegistered ? 'Yes' : 'No'}`);
            console.log(`Last position: ${JSON.stringify(lastPosition)}`);
            console.log(`Player ${playerName} (${socket.id}) removed from game`);
            console.log(`Remaining players: ${Object.keys(players).length}`);
            console.log(`Fully registered players: ${Object.keys(players).filter(id => players[id].fullyRegistered).length}`);
            
            console.log(`Remaining players:`);
            Object.keys(players).forEach(id => {
                if (players[id].fullyRegistered) {
                    console.log(`  - ${players[id].name} (${id}): ${players[id].characterType} with ${players[id].swordType}`);
                }
            });
        } else {
            // Handle disconnection for unregistered socket
            console.log(`Disconnected socket ${socket.id} was not in players object`);
            console.log(`This could happen if the client disconnected before auto-registration completed`);
        }
        console.log(`=============================`);
    });
});

// Start server
const PORT = process.env.PORT || 8989;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});

// Create a separate HTTP server for the diagnostic WebSocket server to avoid conflicts with Socket.io
const diagnosticServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Diagnostic WebSocket server is running');
});

// Create WebSocket server for diagnostics
const wss = new WebSocket.Server({ server: diagnosticServer });

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Diagnostic WebSocket client connected');
    
    // Send server information
    ws.send(JSON.stringify({
        type: 'info',
        data: {
            uptime: process.uptime(),
            serverTime: Date.now(),
            connectedPlayers: Object.keys(players).length,
            fullyRegisteredPlayers: Object.keys(players).filter(id => players[id].fullyRegistered).length
        }
    }));
    
    // Send player list
    ws.send(JSON.stringify({
        type: 'players',
        data: Object.keys(players).map(id => ({
            id: id,
            name: players[id].name,
            fullyRegistered: players[id].fullyRegistered,
            joinedAt: players[id].joinedAt,
            lastActivity: players[id].lastActivity || null
        }))
    }));
    
    // Handle diagnostic commands
    ws.on('message', (message) => {
        try {
            const command = JSON.parse(message);
            
            // Handle different command types
            if (command.type === 'getPlayers') {
                ws.send(JSON.stringify({
                    type: 'players',
                    data: Object.keys(players).map(id => ({
                        id: id,
                        name: players[id].name,
                        fullyRegistered: players[id].fullyRegistered,
                        joinedAt: players[id].joinedAt,
                        lastActivity: players[id].lastActivity || null
                    }))
                }));
            } else if (command.type === 'getStatus') {
                ws.send(JSON.stringify({
                    type: 'status',
                    data: {
                        uptime: process.uptime(),
                        memory: process.memoryUsage(),
                        players: Object.keys(players).length,
                        fullyRegistered: Object.keys(players).filter(id => players[id].fullyRegistered).length
                    }
                }));
            }
        } catch (error) {
            console.error('Error processing diagnostic command:', error);
        }
    });
});

// Start diagnostic server
const DIAGNOSTIC_PORT = 8990;
diagnosticServer.listen(DIAGNOSTIC_PORT, () => {
    console.log(`Diagnostic WebSocket server running on port ${DIAGNOSTIC_PORT}`);
});
