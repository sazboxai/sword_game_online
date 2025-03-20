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
// Track unique sessions for ghost detection
const activeSessions = new Set();
// Track potential ghost players
const potentialGhostPlayers = {};

// Cleanup function for ghost players - improved version
function cleanupGhostPlayers() {
    const currentTime = Date.now();
    const inactiveTimeout = 30000; // 30 seconds
    let removedCount = 0;
    
    // Only print header if we're actually removing players
    let logHeader = false;
    
    // Identify potential ghost players - not updated recently
    for (const id in players) {
        const player = players[id];
        const lastActivity = player.lastActivity || player.joinedAt;
        const inactiveDuration = currentTime - lastActivity;
        
        // If player hasn't updated in a while, mark as potential ghost
        if (inactiveDuration > inactiveTimeout) {
            // Only log the first detection
            if (!potentialGhostPlayers[id]) {
                potentialGhostPlayers[id] = {
                    firstDetectedAt: currentTime,
                    name: player.name,
                    inactiveFor: inactiveDuration
                };
            }
            
            // If player has been inactive for a long time, remove them
            if (inactiveDuration > 120000 || // 2 minutes of inactivity
                (potentialGhostPlayers[id] && (currentTime - potentialGhostPlayers[id].firstDetectedAt > 60000))) {
                
                // Print header if we haven't already
                if (!logHeader) {
                    console.log(`\n[GHOST CLEANUP] Running ghost player cleanup at ${new Date().toISOString()}`);
                    logHeader = true;
                }
                
                console.log(`[GHOST CLEANUP] Removing confirmed ghost player ${player.name} (${id}) - inactive for ${Math.floor(inactiveDuration/1000)}s`);
                
                // Notify all clients that this player left
                io.emit('playerLeft', {
                    id: id,
                    name: player.name,
                    lastPosition: player.position,
                    reason: 'ghost_cleanup'
                });
                
                // Remove player from registry
                delete players[id];
                delete potentialGhostPlayers[id];
                removedCount++;
            }
        } else {
            // Player is active, remove from potential ghosts if present
            if (potentialGhostPlayers[id]) {
                delete potentialGhostPlayers[id];
            }
        }
    }
    
    // Only log summary if we removed players
    if (removedCount > 0) {
        console.log(`[GHOST CLEANUP] Removed ${removedCount} ghost players`);
        console.log(`[GHOST CLEANUP] Cleanup complete. Remaining players: ${Object.keys(players).length}`);
    }
}

// Run cleanup every 15 seconds
setInterval(() => {
    cleanupGhostPlayers();
    
    // Also periodically broadcast player positions to help with synchronization
    for (const id in players) {
        if (players[id].fullyRegistered && players[id].position) {
            const updateId = Date.now().toString() + Math.random().toString(36).substring(2, 5);
            
            // Broadcast to everyone except the player
            io.sockets.sockets.get(id)?.broadcast.emit('playerUpdated', {
                id: id,
                name: players[id].name,
                characterType: players[id].characterType,
                position: players[id].position,
                rotation: players[id].rotation,
                isAttacking: players[id].isAttacking,
                isBlocking: players[id].isBlocking,
                swordType: players[id].swordType,
                health: players[id].health,
                updateId: updateId,
                isForcedSync: true
            });
        }
    }
}, 15000);

// Add interval to log player count - reduced frequency
setInterval(() => {
    const connectedSockets = Object.keys(io.sockets.sockets).length;
    const registeredPlayers = Object.keys(players).filter(id => players[id].fullyRegistered).length;
    
    // Only log if there are actually players connected
    if (registeredPlayers > 0) {
        console.log(`\n[STATUS] Connected clients: ${connectedSockets}, Registered players: ${registeredPlayers}`);
        console.log(`[STATUS] Players:`);
        Object.keys(players).forEach(id => {
            const player = players[id];
            if (player.fullyRegistered) {
                console.log(`  - ${player.name} (${id}): ${player.characterType} with ${player.swordType}`);
            }
        });
    }
}, 30000); // Reduced from 5000ms to 30000ms (30 seconds)

// Handle Socket.io connections
io.on('connection', (socket) => {
    // Log connections with unique IDs
    console.log(`[${new Date().toISOString()}] New client connected - Socket ID: ${socket.id}`);
    
    // Store connection time to track potential ghost connections
    socket.connectionTime = Date.now();
    
    // Send acknowledgment with useful information for client-side debugging
    socket.emit('connect_ack', {
        socketId: socket.id,
        serverTime: Date.now(),
        connectedClients: io.engine.clientsCount,
        playersRegistered: Object.keys(players).length,
        activePlayerIds: Object.keys(players)
    });
    
    // Create a basic player record immediately on connection
    players[socket.id] = {
        id: socket.id,
        name: `Player_${socket.id.substring(0, 5)}`,
        joinedAt: Date.now(),
        fullyRegistered: false,
        characterType: 'knight', // Default character
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        health: 100,
        socketId: socket.id, // Track socket ID explicitly
        lastActivity: Date.now() // Track last activity 
    };
    
    // Handle test events from client
    socket.on('test', (data) => {
        console.log(`\n===== TEST MESSAGE FROM CLIENT ${socket.id} =====`);
        console.log(data);
        
        // Update player's last activity
        if (players[socket.id]) {
            players[socket.id].lastActivity = Date.now();
        }
        
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
        console.log(`Session ID:`, playerData.sessionId || 'Not provided');
        
        // Track session if provided
        if (playerData.sessionId) {
            activeSessions.add(playerData.sessionId);
            console.log(`[SESSION] Added session ${playerData.sessionId} to active sessions`);
            console.log(`[SESSION] Total active sessions: ${activeSessions.size}`);
        }
        
        // Validate and sanitize player name
        let playerName = playerData.name;
        if (!playerName || playerName.trim() === '') {
            playerName = `Player_${socket.id.substring(0, 5)}`;
            console.log(`Using default name for player ${socket.id} because name was empty or invalid`);
        } else {
            playerName = playerName.trim();
            console.log(`Using provided name '${playerName}' for player ${socket.id}`);
        }
        
        // Check if this is a name change
        let isNameChange = false;
        if (players[socket.id] && players[socket.id].name !== playerName) {
            console.log(`Player ${socket.id} changed name from '${players[socket.id].name}' to '${playerName}'`);
            isNameChange = true;
        }
        
        // Update existing player data
        players[socket.id] = {
            ...players[socket.id],
            id: socket.id,
            name: playerName,
            characterType: playerData.characterType || 'knight',
            swordType: playerData.swordType || 'broadsword',
            fullyRegistered: true,
            autoRegistered: false,
            explicitlyRegistered: true,
            lastActivity: Date.now(),
            socketId: socket.id, // Ensure socket ID is explicitly tracked
            sessionId: playerData.sessionId || null // Track client session ID
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
        
        // Also send playerUpdated event if this is a name change
        if (isNameChange) {
            console.log(`Broadcasting playerUpdated event for name change to '${playerName}'`);
            socket.broadcast.emit('playerUpdated', {
                id: socket.id,
                name: playerName,
                characterType: players[socket.id].characterType,
                position: players[socket.id].position,
                rotation: players[socket.id].rotation,
                isAttacking: players[socket.id].isAttacking,
                isBlocking: players[socket.id].isBlocking,
                swordType: players[socket.id].swordType,
                health: players[socket.id].health,
                updateId: Date.now().toString() + Math.random().toString(36).substring(2, 5)
            });
        }
        
        // Remove this player from potential ghosts if listed
        if (potentialGhostPlayers[socket.id]) {
            console.log(`Player ${playerName} (${socket.id}) was marked as potential ghost, removing from ghost list`);
            delete potentialGhostPlayers[socket.id];
        }
        
        // Check for players with the same name but different sockets (potential ghosts)
        for (const id in players) {
            if (id !== socket.id && players[id].name === playerName) {
                console.log(`\n[WARNING] Found another player with same name: ${playerName} (${id})`);
                potentialGhostPlayers[id] = {
                    firstDetectedAt: Date.now(),
                    name: playerName,
                    reason: 'duplicate_name'
                };
            }
        }
        
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
        // Skip logging ping events
        // console.log(`Ping from ${socket.id}, timestamp: ${data.timestamp}`);
        
        // Update player's last activity time for ghost detection
        if (players[socket.id]) {
            players[socket.id].lastActivity = Date.now();
        }
        
        // Handle callback properly with null checks
        if (callback && typeof callback === 'function') {
            try {
                callback({
                    status: 'success',
                    timestamp: Date.now(),
                    clientTimestamp: data?.timestamp || Date.now(),
                    playerId: socket.id,
                    ping: data?.timestamp ? Date.now() - data.timestamp : 0
                });
            } catch (error) {
                console.error(`Error in ping callback for ${socket.id}: ${error.message}`);
            }
        }
    });
    
    // Handle player updates with reduced logging
    socket.on('playerUpdate', (data) => {
        // Ensure the player exists
        if (!players[socket.id]) {
            console.log(`Received update from non-existent player ${socket.id}`);
            return;
        }
        
        // Track the last activity time for ghost detection
        players[socket.id].lastActivity = Date.now();
        
        // Validate position data to prevent errors
        if (data.position && typeof data.position === 'object') {
            const isValidX = typeof data.position.x === 'number' && !isNaN(data.position.x) && isFinite(data.position.x);
            const isValidY = typeof data.position.y === 'number' && !isNaN(data.position.y) && isFinite(data.position.y);
            const isValidZ = typeof data.position.z === 'number' && !isNaN(data.position.z) && isFinite(data.position.z);
            
            if (isValidX && isValidY && isValidZ) {
                // Calculate the movement delta for conditional logging
                let delta = 0;
                if (players[socket.id].position) {
                    const dx = data.position.x - players[socket.id].position.x;
                    const dy = data.position.y - players[socket.id].position.y;
                    const dz = data.position.z - players[socket.id].position.z;
                    delta = Math.sqrt(dx*dx + dy*dy + dz*dz);
                }
                
                // Update player position
                players[socket.id].position = {
                    x: data.position.x,
                    y: data.position.y, 
                    z: data.position.z
                };
                
                // Only log significant movements or test movements
                if (data.isTestMovement && Math.random() < 0.1) { // Only log 10% of test movements
                    console.log(`Test movement from ${socket.id}: (${data.position.x.toFixed(2)}, ${data.position.y.toFixed(2)}, ${data.position.z.toFixed(2)})`);
                } 
                else if (delta > 5.0 && Math.random() < 0.1) { // Only log large movements, and only 10% of them
                    console.log(`Player ${socket.id} moved ${delta.toFixed(2)} units`);
                }
            } else {
                console.log(`Invalid position data from ${socket.id}:`, data.position);
            }
        }
        
        // Handle non-position data (collected first but processed later)
        let updatedFields = false;
        
        // Update rotation if valid
        if (typeof data.rotation === 'number' && !isNaN(data.rotation) && isFinite(data.rotation)) {
            players[socket.id].rotation = data.rotation;
            updatedFields = true;
        }
        
        // Update attack state
        if (typeof data.isAttacking === 'boolean') {
            players[socket.id].isAttacking = data.isAttacking;
            updatedFields = true;
        }
        
        // Update blocking state
        if (typeof data.isBlocking === 'boolean') {
            players[socket.id].isBlocking = data.isBlocking;
            updatedFields = true;
        }
        
        // Update sword type
        if (data.swordType && typeof data.swordType === 'string') {
            players[socket.id].swordType = data.swordType;
            updatedFields = true;
        }
        
        // Update player name if provided
        if (data.name && typeof data.name === 'string' && data.name.trim() !== '') {
            // Only update if name changed
            if (players[socket.id].name !== data.name) {
                console.log(`Player ${socket.id} name changed from '${players[socket.id].name}' to '${data.name}'`);
                players[socket.id].name = data.name;
                updatedFields = true;
            }
        }
        
        // Update character type if provided
        if (data.characterType && typeof data.characterType === 'string') {
            // Only update if character type changed
            if (players[socket.id].characterType !== data.characterType) {
                console.log(`Player ${socket.id} character type changed from '${players[socket.id].characterType}' to '${data.characterType}'`);
                players[socket.id].characterType = data.characterType;
                updatedFields = true;
            }
        }
        
        // Create a timestamp to ensure unique updates
        const updateId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
        
        // OPTIMIZATION: Prioritize position updates by sending immediately
        // Broadcast player update to all other players
        socket.broadcast.emit('playerUpdated', {
            id: socket.id,
            name: players[socket.id].name,
            characterType: players[socket.id].characterType,
            position: players[socket.id].position,
            rotation: players[socket.id].rotation,
            isAttacking: players[socket.id].isAttacking,
            isBlocking: players[socket.id].isBlocking,
            swordType: players[socket.id].swordType,
            health: players[socket.id].health,
            updateId: updateId, // Ensure each update is treated as unique
            timestamp: Date.now() // Add server timestamp for latency calculation
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
            const sessionId = players[socket.id].sessionId;
            
            console.log(`Player ${playerName} (${socket.id}) disconnected`);
            console.log(`Time in game: ${Math.floor(timeInGame / 1000)} seconds`);
            console.log(`Was fully registered: ${wasFullyRegistered ? 'Yes' : 'No'}`);
            console.log(`Last position: ${JSON.stringify(lastPosition)}`);
            
            // Immediately notify ALL clients about this player leaving
            io.emit('playerLeft', {
                id: socket.id,
                name: playerName,
                lastPosition: lastPosition,
                timeInGame: timeInGame,
                reason: 'disconnect',
                socketId: socket.id // Include socket ID for reference
            });
            console.log(`Emitted playerLeft event for ${socket.id} (${playerName}) to ALL clients`);
            
            // Remove player from players object
            delete players[socket.id];
            
            // Also remove from potential ghosts if present
            if (potentialGhostPlayers[socket.id]) {
                delete potentialGhostPlayers[socket.id];
                console.log(`Removed ${socket.id} from potential ghost players list`);
            }
            
            // Track session changes
            if (sessionId) {
                console.log(`Disconnect for player with session ID: ${sessionId}`);
                // Don't remove session immediately, as the player may refresh and reconnect
            }
            
            // Log detailed player information
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
            console.log(`This could happen if the client disconnected before registration completed`);
        }
        console.log(`=============================`);
    });

    // Handle specific ghost player removal request
    socket.on('removeGhostPlayer', (data) => {
        console.log(`[${new Date().toISOString()}] Received request to remove ghost player:`, data);
        
        if (!data || !data.ghostId) {
            console.log('Invalid ghost player removal request - missing ghost ID');
            return;
        }
        
        // Verify that the ghost player exists
        const ghostPlayer = players[data.ghostId];
        if (!ghostPlayer) {
            console.log(`Ghost player with ID ${data.ghostId} not found`);
            return;
        }
        
        // Extra verification - check if name matches
        if (data.playerName && ghostPlayer.name !== data.playerName) {
            console.log(`Ghost player name mismatch: ${ghostPlayer.name} vs ${data.playerName}`);
            // Still proceed with removal, but log the discrepancy
        }
        
        console.log(`[${new Date().toISOString()}] Removing ghost player: ${ghostPlayer.name} (${data.ghostId})`);
        
        // Notify all clients about the player leaving
        io.emit('playerLeft', {
            id: data.ghostId,
            name: ghostPlayer.name,
            reason: 'ghost_player_removal',
            requestedBy: data.newId
        });
        
        // Remove the player from our server-side tracking
        delete players[data.ghostId];
        
        // Confirm removal to the requesting client
        socket.emit('ghostPlayerRemoved', {
            success: true,
            removedId: data.ghostId,
            remainingPlayers: Object.keys(players).length
        });
        
        console.log(`[${new Date().toISOString()}] Ghost player removed. Remaining players: ${Object.keys(players).length}`);
    });

    // Handle specific request for active player list
    socket.on('requestActivePlayersList', () => {
        console.log(`[${new Date().toISOString()}] Player ${socket.id} requested active players list`);
        
        // Send all active player IDs to the client
        socket.emit('activePlayersList', {
            players: Object.keys(players).filter(id => players[id].fullyRegistered),
            timestamp: Date.now()
        });
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

/**
 * Send existing players to a specific client
 */
function sendExistingPlayersToClient(socket) {
    const filteredPlayers = {};
    
    // Only send fully registered players
    Object.keys(players).forEach(id => {
        if (players[id].fullyRegistered) {
            // Create a copy without internal fields
            filteredPlayers[id] = {
                id: players[id].id,
                name: players[id].name,
                characterType: players[id].characterType,
                swordType: players[id].swordType,
                position: players[id].position,
                rotation: players[id].rotation,
                health: players[id].health
            };
        }
    });
    
    // Send the filtered list to the client
    socket.emit('existingPlayers', filteredPlayers);
    
    console.log(`Sending ${Object.keys(filteredPlayers).length} players to ${socket.id}`);
}

// Log that the Socket.io server is ready
console.log('Socket.io server initialized and ready for connections');

