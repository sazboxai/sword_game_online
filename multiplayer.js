/**
 * MultiplayerManager - Manages client-side multiplayer functionality
 * This class handles all interaction with the Socket.io server
 */
class MultiplayerManager {
    constructor(config = {}) {
        // Initialize arrays and objects to prevent undefined errors
        this.remotePlayers = {};
        this._reconnectionLogs = [];
        this.reconnectionLogs = [];
        
        // Initialize network quality tracking
        this._networkStats = {
            latencies: [],
            averageLatency: 0,
            jitter: 0,
            lastMeasurement: 0,
            packetsReceived: 0,
            measurementInterval: 5000, // ms between network quality calculations
            maxSamples: 50,            // Maximum number of latency samples to keep
            qualityLevel: 'unknown'    // Network quality assessment
        };
        
        // Defaults for game state
        this.connected = false;
        this.socket = null;
        this.playerName = '';
        this.characterType = '';
        this.swordType = '';
        this.sessionId = '';
        
        // Configure from options if provided
        if (config.game) {
            this.game = config.game;
            if (this.game.engine) {
                this.initialize(this.game.engine);
            }
        }
        
        this.debugElement = null;
        
        // Track remote players
        this.remotePlayers = {};
        
        // Player details
        this.playerName = null;
        this.characterType = null;
        this.playerId = null;
        this.swordType = 'normal';
        this.lastPosition = null;
        this.lastRotation = null;
        
        // Session tracking for identifying reconnections and ghost players
        this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        this.previousSessionId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.isReconnecting = false;
        this.reconnectTimerId = null;
        this.disconnectedAt = null;
        this.savedPlayerState = null;
        
        // Game reference (will be set once the game is initialized)
        this.game = null;
        
        // For reporting connection status
        this.connectionStatusElement = document.getElementById('connection-status');
        this.statusMessageElement = document.getElementById('status-message');
        this.playerCountElement = document.getElementById('player-count');
        
        // Debug info display element
        this.debugElement = document.getElementById('debug-info') || this.createDebugElement();
        
        // Internal tracking variables
        this._lastConsistencyCheck = 0;
        this._lastPositionUpdateTime = 0;
        this._lastPositionLog = 0;
        this._activePlayerIds = [];
        
        // Reconnection logging for easier debugging
        this.reconnectionLogs = [];
        
        this.log('Multiplayer module initialized');
        
        // Double check initialization
        this.ensureInitialized();
        
        // Check if the config is actually the game engine instance
        // This handles cases where the game is passed directly to the constructor
        if (config && (config.scene || config.renderer)) {
            this.logReconnection(`Game engine passed to constructor, initializing immediately`);
            this.initialize(config);
        }
    }
    
    /**
     * Initialize the multiplayer manager with the game engine
     * @param {object} game - The game engine instance
     */
    initialize(game) {
        // Ensure all properties are initialized
        this.ensureInitialized();
        
        this.logReconnection(`Initializing multiplayer with game engine`, {
            gameProvided: !!game,
            existingPlayers: Object.keys(this.remotePlayers).length
        });
        
        // Store reference to game
        this.game = game;
        
        // Also store a global reference for emergency mesh recovery
        if (game && !window.gameInstance) {
            window.gameInstance = game;
            this.logReconnection(`Stored global reference to game engine`);
        }
        
        // Create meshes for all existing players
        this.createMeshesForExistingPlayers();
        
        // Set up a callback for when scene is ready
        if (game && game.scene) {
            // If scene is already loaded, create meshes immediately
            this.onSceneReady();
        } else if (game) {
            // Add listener for scene ready event - Three.js doesn't have a direct equivalent,
            // so we'll use a timeout or check for the scene in intervals
            this.logReconnection(`Waiting for scene to be ready`);
            
            // Check for scene availability every 100ms
            const checkSceneReady = setInterval(() => {
                if (game.scene) {
                    clearInterval(checkSceneReady);
                    this.onSceneReady();
                }
            }, 100);
            
            // Fallback timeout after 5 seconds
            setTimeout(() => {
                clearInterval(checkSceneReady);
                if (game.scene) {
                    this.onSceneReady();
                } else {
                    this.logReconnection(`Scene failed to load after timeout`);
                }
            }, 5000);
        }
        
        return this;
    }
    
    /**
     * Handler for when the scene is ready
     */
    onSceneReady() {
        this.logReconnection(`Scene is ready, creating meshes for existing players`);
        this.createMeshesForExistingPlayers();
        
        // Request existing players from server to ensure we have latest data
        if (this.socket && this.socket.connected) {
            this.logReconnection(`Requesting existing players from server after scene ready`);
            this.socket.emit('requestExistingPlayers');
        }
    }
    
    /**
     * Create meshes for all existing players
     */
    createMeshesForExistingPlayers() {
        if (!this.game || !this.game.scene) {
            this.logReconnection(`Cannot create meshes - game or scene not available`);
            return;
        }
        
        const playerCount = Object.keys(this.remotePlayers).length;
        this.logReconnection(`Creating meshes for ${playerCount} existing players using Three.js`);
        
        // Loop through all remote players and create meshes for them
        for (const id in this.remotePlayers) {
            const player = this.remotePlayers[id];
            
            // Check if player already has a mesh by traversing the scene
            let existingMesh = null;
            this.game.scene.traverse(obj => {
                if (obj.name === `player_${id}`) {
                    existingMesh = obj;
                }
            });
            
            if (existingMesh) {
                this.logReconnection(`Player ${player.name} (${id}) already has a mesh, updating position`);
                existingMesh.position.x = player.position.x || 0;
                existingMesh.position.y = player.position.y || 0;
                existingMesh.position.z = player.position.z || 0;
                existingMesh.rotation.y = player.rotation || 0;
                existingMesh.visible = true;
                continue;
            }
            
            // Create mesh for player
            this.logReconnection(`Creating Three.js mesh for player ${player.name} (${id})`);
            const mesh = this.createRemotePlayerMesh(id, player);
            
            if (mesh) {
                this.logReconnection(`Successfully created mesh for player ${player.name}`, {
                    id,
                    meshName: mesh.name,
                    position: {
                        x: mesh.position.x,
                        y: mesh.position.y,
                        z: mesh.position.z
                    },
                    isVisible: mesh.visible
                });
                
                // Create name tag
                this.createNameTag(id, player);
            } else {
                this.logReconnection(`Failed to create mesh for player ${player.name} (${id})`);
            }
        }
        
        this.logReconnection(`Finished creating meshes for existing players`);
    }
    
    /**
     * Sets up periodic ghost player cleanup
     */
    setupGhostPlayerCleanup() {
        // Check for ghost players every 5 seconds (reduced from 10)
        setInterval(() => this.cleanupGhostPlayers(), 5000);
        
        // Also add a ping test every 2 seconds to check for disconnected players
        setInterval(() => {
            if (this.connected && this.socket) {
                this.socket.emit('ping', { timestamp: Date.now() }, (response) => {
                    if (response && response.status === 'success') {
                        this.lastServerResponse = Date.now();
                    }
                });
            }
        }, 2000);
        
        this.log('Set up ghost player cleanup interval');
    }
    
    /**
     * Clean up any detected ghost players (players from previous sessions)
     */
    cleanupGhostPlayers() {
        if (!this.remotePlayers || !this.socket) return;
        
        const currentTime = Date.now();
        const playersToRemove = new Set();
        
        // More realistic time thresholds
        const inactivityTimeout = 60000; // 60 seconds (increased from 30s)
        const longInactivityTimeout = 120000; // 2 minutes (increased from 60s)
        
        this.logReconnection(`Running ghost player cleanup with ${Object.keys(this.remotePlayers).length} remote players`);
        
        // Get list of currently active players from socket
        const activePlayerIds = Array.isArray(this._activePlayerIds) ? this._activePlayerIds : [];
        this.logReconnection(`Server reported ${activePlayerIds.length} active players`);
        
        // Identify ghost players based on multiple criteria
        Object.entries(this.remotePlayers).forEach(([id, player]) => {
            // Skip if this player has received a position update in the last 10 seconds
            // This ensures active players are never removed regardless of other criteria
            if (player._lastUpdateTime && (currentTime - player._lastUpdateTime < 10000)) {
                return;
            }
            
            let isInactive = false;
            let isDisconnected = !activePlayerIds.includes(id);
            let isDifferentSession = false;
            
            // Check for inactivity
            if (player._lastUpdateTime) {
                const inactiveTime = currentTime - player._lastUpdateTime;
                isInactive = inactiveTime > inactivityTimeout;
                
                if (isInactive) {
                    this.logReconnection(`Inactive player detected: ${player.name} (${id}) - inactive for ${Math.floor(inactiveTime/1000)}s`);
                }
            }
            
            // Check for very long inactivity - always remove very stale players
            if (player._lastUpdateTime && (currentTime - player._lastUpdateTime > longInactivityTimeout)) {
                this.logReconnection(`Player ${player.name} (${id}) is VERY inactive (${Math.floor((currentTime - player._lastUpdateTime)/1000)}s), marking for removal`);
                playersToRemove.add(id);
                return; // Skip further checks for this player
            }
            
            // Check if the player is from a different session
            if (player._sourceInfo && player._sourceInfo.sessionId && 
                player._sourceInfo.sessionId !== this.sessionId) {
                isDifferentSession = true;
            }
            
            // Only consider it a ghost if BOTH inactive AND disconnected
            // This prevents removing players that are still connected but just not moving
            if (isInactive && isDisconnected) {
                this.logReconnection(`Ghost player detected: ${player.name} (${id}) - inactive: ${isInactive}, disconnected: ${isDisconnected}, different session: ${isDifferentSession}`);
                playersToRemove.add(id);
            }
        });
        
        // Process each player we identified for removal
        if (playersToRemove.size > 0) {
            this.logReconnection(`Removing ${playersToRemove.size} ghost players...`);
            
            // Remove each identified ghost player
            playersToRemove.forEach(id => {
                this.logReconnection(`Removing ghost player: ${this.remotePlayers[id]?.name || id}`);
                this.removeRemotePlayer(id, true); // Pass true to indicate this is a ghost removal
            });
            
            // Update player count display
            this.updatePlayerCount();
            
            // Request fresh player list from server
            if (this.socket && this.socket.connected) {
                this.logReconnection(`Requesting fresh player list after ghost cleanup`);
                this.socket.emit('requestExistingPlayers');
            }
            
            this.logReconnection(`Ghost player cleanup complete, removed ${playersToRemove.size} players`);
                } else {
            this.logReconnection(`No ghost players detected during cleanup`);
        }
    }
    
    /**
     * Initializes the multiplayer manager with the player character
     * @param {Character} playerCharacter - The local player's character
     */
    initializeWithCharacter(playerCharacter) {
        this.log('Initializing multiplayer with character');
        
        // Store reference to player character
        this.playerCharacter = playerCharacter;
        
        // Update character type and sword type from player character
        if (playerCharacter) {
            this.characterType = playerCharacter.type;
            this.swordType = playerCharacter.swordType;
            this.log(`Updated character type to ${this.characterType} and sword type to ${this.swordType}`);
        }
        
        // Connect to the server if we haven't already
        if (!this.connected && this.playerName) {
            this.connect(this.playerName, this.characterType, this.swordType);
        }
    }
    
    /**
     * Connect to the server
     * @param {string} playerName - The name of the player
     * @param {string} characterType - The type of character
     * @param {string} swordType - The type of sword
     * @returns {boolean} - Whether the connection attempt was initiated
     */
    connect(playerName, characterType, swordType = 'normal') {
        // Ensure all properties are initialized
        this.ensureInitialized();
        
        if (this.connected) {
            this.log('Already connected to server');
            return;
        }
        
        // Store player details
        this.playerName = playerName;
        this.characterType = characterType || 'knight';
        this.swordType = swordType;
        
        this.logReconnection(`Connecting to server`, {
            playerName,
            characterType,
            swordType,
            sessionId: this.sessionId,
            isReconnecting: this.isReconnecting
        });
        
        // Update connection status
        this.updateConnectionStatus('connecting', 'Connecting to server...');
        
        // Create socket connection if not already present
            if (!this.socket) {
            try {
                this.logReconnection(`Creating new socket connection`);
                
                // Create the io object in a safe way
                if (typeof io === 'undefined') {
                    this.log('ERROR: Socket.io library not loaded!');
                    this.updateConnectionStatus('error', 'Socket.io library not loaded!');
                    return;
                }
                
                // Create socket
                this.socket = io(this.config.serverUrl, {
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    timeout: 20000,
                    autoConnect: true
                });
                
                // Set up event handlers for the socket
            this.setupSocketEvents();
                
                // Set up ping/heartbeat for connection monitoring
                this.startHeartbeat();
                
                // Set up recurring ghost cleanup
                this.setupGhostPlayerCleanup();
            } catch (error) {
                this.log(`ERROR: Failed to connect to server: ${error.message}`);
                this.updateConnectionStatus('error', `Failed to connect: ${error.message}`);
                return;
            }
        }
        
        // Register the player once connected
        if (this.socket.connected) {
            this.registerPlayer(this.isReconnecting);
        } else {
            // Wait for socket to connect then register
            this.socket.once('connect', () => {
                this.registerPlayer(this.isReconnecting);
            });
        }
    }
    
    /**
     * Sets up Socket.io event handlers
     */
    setupSocketEvents() {
        if (!this.socket) {
            this.logReconnection('Cannot setup socket events: no socket');
            return;
        }
        
        // Connected to server
        this.socket.on('connect', () => {
            this.connected = true;
            this.log('Connected to server');
            
            // Reset connection-related state
            this.remotePlayers = {};
            
            // Begin network quality monitoring
            this._startNetworkMonitoring();
            
            // Start registering as a connected player
            if (this.playerName) {
            if (this.isReconnecting) {
                    this.logReconnection(`Reconnection successful, registering with previous session info`);
                    this.registerPlayer(true);
            } else {
                    this.log(`New connection, registering as ${this.playerName}`);
                    this.registerPlayer(false);
                }
                
                // Request existing players to populate our world
                this.socket.emit('requestExistingPlayers');
            }
        });
        
        // Connection acknowledgment - received right after connection
        this.socket.on('connect_ack', (data) => {
            this.playerId = data.socketId;
            this.log(`Server acknowledged connection: ${this.playerId}`);
            this.log(`Connected clients: ${data.connectedClients}`);
            this.log(`Players registered: ${data.playersRegistered}`);
            
            // Start sending regular updates as soon as we're connected and registered
            if (this.playerName) {
                setTimeout(() => {
                    // Force an immediate position update to ensure our name is propagated
                    this.log(`Sending forced initial player update to ensure name propagation`);
                    this.updatePosition();
                }, 500);
            }
            
            // Store server time offset for potential time synchronization
            const clientTime = Date.now();
            this.serverTimeOffset = data.serverTime - clientTime;
            
            // Store active player IDs for ghost detection
            if (Array.isArray(data.activePlayerIds)) {
                this._activePlayerIds = data.activePlayerIds;
                this.logReconnection(`Received active player IDs from server`, { count: data.activePlayerIds.length });
            }
            
            this.updateConnectionStatus('verified', `Connected to server with ${data.connectedClients} client(s)`);
            
            // Update player count display
            const playerCount = data.playersRegistered || 0;
            this.updatePlayerCount(playerCount);
            
            // If we see our previous player ID in the active player list, mark it for cleanup
            if (this.previousPlayerId && data.activePlayerIds.includes(this.previousPlayerId)) {
                this.logReconnection(`Found previous player ID still active on server`, {
                    previousId: this.previousPlayerId
                });
                
                // Send a specific request to remove the ghost player
                this.socket.emit('removeGhostPlayer', {
                    ghostId: this.previousPlayerId,
                    newId: this.socket.id,
                    playerName: this.playerName,
                    sessionId: this.sessionId,
                    previousSessionId: this.previousSessionId
                });
            }
        });
        
        // Connection error
        this.socket.on('connect_error', (error) => {
            this.log(`Connection error: ${error.message}`);
            this.updateConnectionStatus('error', 'Connection error');
        });
        
        // Disconnection
        this.socket.on('disconnect', (reason) => {
            this.connected = false;
            this.logReconnection(`Socket disconnected`, { 
                reason, 
                socketId: this.socket.id, 
                playerName: this.playerName
            });
            
            // Record the time of disconnect for potential reconnection tracking
            this.disconnectedAt = Date.now();
            this.logReconnection(`Recorded disconnect time`, { 
                time: this.disconnectedAt 
            });
            
            // Show the reconnection logs modal automatically to help debug
            setTimeout(() => this.showReconnectionLogs(), 500);
            
            // Clear heartbeat interval
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
            
            // Handle reconnection based on disconnect reason
            if (reason === 'io server disconnect') {
                // Server initiated disconnect, try to reconnect manually
                this.reconnect(reason);
            } else if (reason === 'transport close') {
                // Transport layer closed, needs special handling
                this.reconnect(reason);
            }
        });
        
        // Reconnection attempt
        this.socket.on('reconnect_attempt', (attemptNumber) => {
            this.log(`Reconnection attempt ${attemptNumber}...`);
            this.updateConnectionStatus('connecting', `Reconnecting (attempt ${attemptNumber})...`);
        });
        
        // Reconnection error
        this.socket.on('reconnect_error', (error) => {
            this.log(`Reconnection error: ${error.message}`);
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.log('Max reconnection attempts reached. Giving up.');
                this.updateConnectionStatus('error', 'Failed to reconnect');
            }
        });
        
        // Reconnection successful
        this.socket.on('reconnect', (attemptNumber) => {
            this.connected = true;
            this.log(`Reconnected to server after ${attemptNumber} attempts`);
            this.updateConnectionStatus('connected', 'Reconnected');
            
            // Register player with server again
            this.registerPlayer();
        });
        
        // Ping response
        this.socket.on('pong', (data) => {
            const latency = Date.now() - data.timestamp;
            this.lastServerResponse = Date.now();
            this.log(`Received pong. Latency: ${latency}ms`);
        });
        
        // Handle existing players list received from server
        this.socket.on('existingPlayers', (playersData) => {
            this.logReconnection(`Received existingPlayers event from server`, {
                receivedCount: Object.keys(playersData).length,
                players: Object.entries(playersData).map(([id, data]) => ({
                    id: id,
                    name: data.name,
                    characterType: data.characterType
                }))
            });
            
            if (Object.keys(playersData).length === 0) {
                this.logReconnection(`WARNING: No existing players received from server`);
            }
            
            // Add each player to our game
            for (const id in playersData) {
                const playerData = playersData[id];
                
                // Skip if this is our own player (shouldn't happen but just in case)
                if (id === this.socket.id) {
                    this.logReconnection(`Skipping self in existingPlayers list`, { id });
                    continue;
                }
                
                // Check if we already have this player
                if (this.remotePlayers[id]) {
                    this.logReconnection(`Player ${playerData.name} (${id}) already exists, updating instead`, {
                        existing: true,
                        lastUpdateTime: this.remotePlayers[id]._lastUpdateTime || 'unknown'
                    });
                    this.updateRemotePlayer(playerData);
                } else {
                    this.logReconnection(`Adding new remote player from existingPlayers list`, {
                        id,
                        name: playerData.name,
                        characterType: playerData.characterType
                    });
                    this.addRemotePlayer(playerData);
                }
            }
            
            // Perform a visibility check to ensure players are rendered
            setTimeout(() => {
                const remotePlayerCount = Object.keys(this.remotePlayers).length;
                
                // Count player meshes using Three.js traversal
                let visibleMeshCount = 0;
                if (this.game && this.game.scene) {
                    this.game.scene.traverse(obj => {
                        if (obj.name && (
                            obj.name.startsWith('player_') || 
                            obj.name.startsWith('sword_') || 
                            obj.name.startsWith('nameTag_')
                        )) {
                            visibleMeshCount++;
                        }
                    });
                }
                
                this.logReconnection(`Visibility check after existingPlayers process`, {
                    remotePlayerCount,
                    visibleMeshes: visibleMeshCount
                });
                
                // Count actual player meshes in the scene (not swords or name tags)
                const playerMeshes = [];
                if (this.game && this.game.scene) {
                    this.game.scene.traverse(obj => {
                        if (obj.name && obj.name.startsWith('player_') && !obj.name.includes('sword') && !obj.name.includes('nameTag')) {
                            playerMeshes.push(obj);
                        }
                    });
                }
                
                if (playerMeshes.length < remotePlayerCount) {
                    this.logReconnection(`WARNING: Some players might not be visible`, {
                        expectedPlayers: remotePlayerCount,
                        visiblePlayerMeshes: playerMeshes.length,
                        visiblePlayerIds: playerMeshes.map(m => m.name.split('_')[1])
                    });
                    
                    // Try to force-refresh player visibility
                    this.socket.emit('requestExistingPlayers');
                    
                    // Also ensure the game is properly initialized
                    if (window.gameInstance && (!this.game || !this.game.scene)) {
                        this.logReconnection(`Attempting to fix game reference`);
                        this.initialize(window.gameInstance);
                    }
                }
            }, 1000);
            
            // Update the player count display
            this.updatePlayerCount();
        });
        
        // Debug message from server
        this.socket.on('debugMessage', (data) => {
            this.log(`Debug message from server: ${data.message}`);
            
            if (data.players && data.players.length > 0) {
                this.log(`Other players: ${data.players.join(', ')}`);
            } else {
                this.log(`No other players online`);
            }
        });
        
        // New player joined
        this.socket.on('playerJoined', (playerData) => {
            this.log(`Player joined: ${playerData.name} (${playerData.id}) with ${playerData.characterType}`);
            
            // Skip if this is us
            if (playerData.id === this.socket.id) {
                this.log(`Skipping adding ourselves as a remote player`);
                return;
            }
            
            // Skip if we already have this player
            if (this.remotePlayers[playerData.id]) {
                this.log(`Player ${playerData.name} (${playerData.id}) already exists, updating instead of adding`);
                this.updateRemotePlayer(playerData);
                return;
            }
            
            // Add remote player
            this.addRemotePlayer(playerData);
            
            // Update player count display
            this.updatePlayerCount();
        });
        
        // Player left
        this.socket.on('playerLeft', (data) => {
            const reason = data.reason || 'unknown';
            this.log(`Player ${data.name} (${data.id}) left the game. Reason: ${reason}`);
            
            // Try to find the player in our remotePlayers list
            // Check both by ID and by socketId which might be different
            let foundPlayerToRemove = false;
            const playerIdToRemove = data.id;
            const socketIdToRemove = data.socketId;
            
            if (this.remotePlayers[playerIdToRemove]) {
                // Remove the player immediately from our rendering
                this.log(`Found player ${data.name} with ID ${playerIdToRemove} - removing immediately`);
                this.removeRemotePlayer(playerIdToRemove);
                foundPlayerToRemove = true;
            } 
            // Also check if we find the player by socket ID
            else if (socketIdToRemove) {
                // Look through players to find one with this socket ID
                for (const id in this.remotePlayers) {
                    const player = this.remotePlayers[id];
                    if (player._sourceInfo && player._sourceInfo.socketID === socketIdToRemove) {
                        this.log(`Found player by socket ID ${socketIdToRemove} - removing immediately`);
                        this.removeRemotePlayer(id);
                        foundPlayerToRemove = true;
                        break;
                    }
                }
            }
            
            if (!foundPlayerToRemove) {
                this.log(`WARNING: Could not find player ${data.name} (${data.id}) in remotePlayers list`);
                // Force a ghost player cleanup right now
                this.cleanupGhostPlayers();
            }
            
            // Ensure our local tracking is updated
            this.updatePlayerCount();
        });
        
        // Player updated
        this.socket.on('playerUpdated', (playerData) => {
            // Track network stats for this update
            if (playerData.timestamp) {
                const latency = Date.now() - playerData.timestamp;
                this._trackLatency(latency);
            }
            
            // Immediately log every update to help diagnose the issue
            this.logReconnection(`📍 POSITION UPDATE for ${playerData.id}`, {
                position: playerData.position,
                rotation: playerData.rotation,
                updateId: playerData.updateId
            });
            
            // Verify we have this player in our remotePlayers dictionary
            if (!this.remotePlayers[playerData.id]) {
                this.logReconnection(`CRITICAL: Received update for unknown player ${playerData.id}, requesting player data`);
                this.socket.emit('requestExistingPlayers');
                
                // Aggressively add this player since we're getting updates for them
                if (playerData.name && playerData.characterType) {
                    this.logReconnection(`Creating missing player ${playerData.id} after receiving position update`);
                    this.addRemotePlayer(playerData);
                }
                return;
            }
            
            // Update remote player with the received data
            this.updateRemotePlayer(playerData);
            
            // Force mesh to be visible and verify position was updated
            if (this.game && this.game.scene) {
                let playerMesh = null;
                this.game.scene.traverse(obj => {
                    if (obj.name === `player_${playerData.id}`) {
                        playerMesh = obj;
                    }
                });
                
                if (playerMesh) {
                    // Force visibility
                    if (!playerMesh.visible) {
                        this.logReconnection(`Making player ${playerData.id} visible after position update`);
                        playerMesh.visible = true;
                    }
                    
                    // Verify position was applied
                    if (playerData.position && 
                        (Math.abs(playerMesh.position.x - playerData.position.x) > 0.01 ||
                         Math.abs(playerMesh.position.y - playerData.position.y) > 0.01 ||
                         Math.abs(playerMesh.position.z - playerData.position.z) > 0.01)) {
                        
                        this.logReconnection(`Position mismatch detected for ${playerData.id}, forcing update`, {
                            received: playerData.position,
                            current: {
                                x: playerMesh.position.x,
                                y: playerMesh.position.y,
                                z: playerMesh.position.z
                            }
                        });
                        
                        // Force position update
                        playerMesh.position.set(
                            playerData.position.x,
                            playerData.position.y,
                            playerData.position.z
                        );
                    }
                } else {
                    // Mesh missing despite having player data - create it
                    this.logReconnection(`Player ${playerData.id} missing mesh after position update, creating now`);
                    this.createRemotePlayerMesh(playerData.id, this.remotePlayers[playerData.id]);
                }
            }
        });
        
        // Player attacked
        this.socket.on('playerAttacked', (data) => {
            // Handle remote player attack
            this.handleRemotePlayerAttack(data);
        });
        
        // Player took damage
        this.socket.on('playerDamaged', (data) => {
            this.log(`Player ${data.id} took ${data.amount} damage from ${data.attackerId}`);
            
            // If this is us, update our health
            if (data.id === this.socket.id && this.game.playerCharacter) {
                this.game.playerCharacter.takeDamage(data.amount, data.attackerId);
                
                // Check if we've been defeated
                if (this.game.playerCharacter.health <= 0) {
                    this.game.playerCharacter.showRespawnUI();
                }
            }
            
            // If this is a remote player, update their health
            if (this.remotePlayers[data.id]) {
                this.remotePlayers[data.id].health = data.newHealth;
                
                // Update health bar if they have one
                if (this.remotePlayers[data.id].healthBar) {
                    const healthPercent = Math.max(0, data.newHealth) / 100;
                    this.remotePlayers[data.id].healthBar.scale.x = healthPercent;
                }
                
                // If they've been defeated, hide them
                if (data.newHealth <= 0) {
                    this.remotePlayers[data.id].visible = false;
                }
            }
        });
        
        // Player respawned
        this.socket.on('playerRespawned', (data) => {
            this.log(`Player ${data.id} respawned at position (${data.position.x}, ${data.position.y}, ${data.position.z})`);
            
            // If this is a remote player, update their position and make them visible
            if (this.remotePlayers[data.id]) {
                this.remotePlayers[data.id].position.set(data.position.x, data.position.y, data.position.z);
                this.remotePlayers[data.id].visible = true;
                this.remotePlayers[data.id].health = 100;
                
                // Update health bar
                if (this.remotePlayers[data.id].healthBar) {
                    this.remotePlayers[data.id].healthBar.scale.x = 1;
                }
            }
        });
        
        // Ghost player removed confirmation
        this.socket.on('ghostPlayerRemoved', (data) => {
            this.logReconnection(`Ghost player removal confirmed by server`, data);
            
            // If this was our previous ghost, store that it's been taken care of
            if (data.removedId === this.previousPlayerId) {
                this.previousPlayerId = null;
                this.logReconnection(`Previous player ghost has been removed`);
            }
            
            // Force refresh our local display of players
            this.socket.emit('requestExistingPlayers');
        });
        
        // Handle position sync from server (new handler)
        this.socket.on('syncPosition', (data) => {
            this.logReconnection(`Received position sync from server`, data);
            
            // If this is our own position, check if it's accurate
            if (data.id === this.socket.id && this.game && this.game.playerCharacter) {
                const myPos = this.game.playerCharacter.mesh.position;
                const serverPos = data.position;
                
                // Calculate discrepancy
                const dx = myPos.x - serverPos.x;
                const dy = myPos.y - serverPos.y;
                const dz = myPos.z - serverPos.z;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                this.logReconnection(`Position sync check`, {
                    myPosition: {x: myPos.x, y: myPos.y, z: myPos.z},
                    serverPosition: serverPos,
                    discrepancy: distance
                });
                
                // If server position is significantly different, update it
                if (distance > 5) {
                    this.logReconnection(`Correcting large position discrepancy (${distance.toFixed(2)} units)`);
                    // Send an immediate position update to correct
                    this.socket.emit('playerUpdate', {
                        id: this.socket.id,
                        position: {x: myPos.x, y: myPos.y, z: myPos.z},
                        rotation: this.game.playerCharacter.mesh.rotation.y,
                        timestamp: Date.now(),
                        updateId: `correction_${Date.now()}`
                    });
                }
            }
            // For other players, we process updates as normal
            else if (data.id !== this.socket.id) {
                this.updateRemotePlayer(data);
            }
        });
        
        // Handle active players list from server (new handler)
        this.socket.on('activePlayersList', (data) => {
            this.logReconnection(`Received active players list from server`, {
                count: data.players.length,
                players: data.players
            });
            
            // Store active player IDs for ghost detection
            this._activePlayerIds = data.players;
            
            // Remove any remote players not in the active list
            for (const id in this.remotePlayers) {
                if (!data.players.includes(id) && id !== this.socket.id) {
                    this.logReconnection(`Player ${id} not in active players list, marking for removal`);
                    // Mark as inactive - will be removed on next cleanup if still inactive
                    if (this.remotePlayers[id]) {
                        this.remotePlayers[id]._serverConfirmedInactive = true;
                    }
                }
            }
        });
    }
    
    /**
     * Starts the heartbeat interval to monitor connection health
     */
    startHeartbeat() {
        // Clear any existing interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        // Start a new interval
        this.lastServerResponse = Date.now();
        this.heartbeatInterval = setInterval(() => {
            // Send ping to server
            this.socket.emit('ping', { timestamp: Date.now() }, (response) => {
                if (response && response.status === 'success') {
                    this.lastServerResponse = Date.now();
                    this.connectionTimeouts = 0;
                }
            });
            
            // Check if we've timed out
            const timeSinceLastResponse = Date.now() - this.lastServerResponse;
            if (timeSinceLastResponse > 5000) {
                this.connectionTimeouts++;
                this.log(`Connection timeout ${this.connectionTimeouts}. No response for ${timeSinceLastResponse}ms`);
                
                if (this.connectionTimeouts >= 3) {
                    this.log('Connection considered dead. Attempting to reconnect...');
                    this.socket.disconnect();
                    this.reconnect();
                }
            }
        }, 2000);
    }
    
    /**
     * Attempt to reconnect to the server
     * @param {string} [reason] - The reason for reconnection
     */
    reconnect(reason) {
        // If already in the process of reconnecting, don't start another attempt
        if (this._isReconnecting) {
            this.logReconnection(`Already attempting to reconnect, skipping new attempt`);
            return;
        }
        
        this._isReconnecting = true;
            this.reconnectAttempts++;
        
            this.logReconnection(`Reconnection attempt ${this.reconnectAttempts}`, { 
            reason,
                attempts: this.reconnectAttempts,
                maxAttempts: this.maxReconnectAttempts
            });
        
        // If we've exceeded our max attempts, stop trying
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            this.logReconnection(`Max reconnection attempts (${this.maxReconnectAttempts}) exceeded, giving up`);
            this.updateConnectionStatus('disconnected', 'Unable to reconnect after multiple attempts');
            this._isReconnecting = false;
            return;
        }
        
        // Store the previous session ID for tracking reconnection
        if (this.sessionId) {
            this.previousSessionId = this.sessionId;
            this.logReconnection(`Stored previous session ID for reconnection tracking`, {
                previousSessionId: this.previousSessionId
            });
        }
            
        // Store player state for reconnection (position, health, etc.)
            if (this.game && this.game.playerCharacter) {
            const position = this.game.playerCharacter.getPosition();
            const health = this.game.playerCharacter.health;
            const swordType = this.game.playerCharacter.swordType;
            
            this.reconnectionState = {
                position,
                health,
                swordType
            };
            
            this.logReconnection(`Saved player state`, this.reconnectionState);
        }
        
        // Flag that we're reconnecting for the connection process
            this.isReconnecting = true;
            this.logReconnection(`Set reconnection flag to true before connection attempt`);
            
        // More aggressive reconnection strategy for transport errors
        if (reason === 'transport close' || reason === 'transport error') {
            this.logReconnection(`Using aggressive reconnection strategy for ${reason}`);
            
            // Force disconnect the existing socket if it's still around
                if (this.socket) {
                this.logReconnection(`Forced disconnect of existing socket before reconnection`);
                    try {
                        this.socket.disconnect();
                } catch (e) {
                    this.logReconnection(`Error disconnecting socket: ${e.message}`);
                    }
                }
                
            // Create a new socket and attempt reconnection immediately
                setTimeout(() => {
                this.logReconnection(`Creating new socket connection for reconnection`);
                this.connect(this.playerName, this.game.playerCharacter.type, this.game.playerCharacter.swordType);
                    
                // Additionally, we'll force refresh all players after reconnection
                    setTimeout(() => {
                    this.logReconnection(`Forcing refresh of all player meshes after reconnection`);
                    this.forceRefresh();
                    this._isReconnecting = false;
                    }, 2000);
            }, 500);
        } else {
            // For other disconnect reasons, use normal reconnection
            this.logReconnection(`Using standard reconnection strategy for ${reason}`);
            
            setTimeout(() => {
                if (this.socket && this.socket.disconnected) {
                    this.logReconnection(`Attempting to reconnect socket`);
                    this.socket.connect();
        } else {
                    this.logReconnection(`Creating new socket for reconnection`);
                    this.connect(this.playerName, this.game.playerCharacter.type, this.game.playerCharacter.swordType);
                }
                this._isReconnecting = false;
            }, 1000);
        }
    }
    
    /**
     * Registers the player with the server
     * @param {boolean} isReconnecting - Whether this registration is part of a reconnection
     */
    registerPlayer(isReconnecting = false) {
        // Check if we have a socket and it's connected
        if (!this.socket || !this.socket.connected) {
            this.logReconnection(`Cannot register player - socket not connected`, {
                socketExists: !!this.socket,
                socketConnected: this.socket?.connected
            });
            return;
        }
        
        // Always check the main isReconnecting flag as well
        isReconnecting = isReconnecting || this.isReconnecting;
        
        // Prepare player data
        const playerData = {
            id: this.socket.id,
            name: this.playerName,
            characterType: this.characterType,
            swordType: this.swordType,
            position: this.savedPlayerState?.position || { x: 0, y: 0, z: 0 },
            rotation: this.savedPlayerState?.rotation || 0,
            sessionId: this.sessionId,
            timestamp: Date.now(),
            // Add additional info for reconnection scenarios
            isReconnecting: isReconnecting,
            previousSessionId: this.previousSessionId || null,
            previousDisconnectTime: this.disconnectedAt || null
        };
        
        this.logReconnection(`Registering player with server`, {
            name: playerData.name,
            socketId: this.socket.id,
            isReconnecting: isReconnecting,
            sessionId: this.sessionId,
            previousSessionId: this.previousSessionId
        });
        
        // Store our player ID for future reference
        this.playerId = this.socket.id;
        
        // Remember previous player ID when reconnecting for ghost cleanup
        if (isReconnecting && !this.previousPlayerId) {
            // Store previous player ID for ghost cleanup
            this.previousPlayerId = `${this.playerName}_${this.previousSessionId}`;
            this.logReconnection(`Stored previous player ID for ghost cleanup`, {
                previousPlayerId: this.previousPlayerId
            });
        }
        
        // Register with the server
        this.socket.emit('playerJoin', playerData);
        
        // For reconnection scenarios, emit an explicit reconnection event immediately after playerJoin
        if (isReconnecting && this.previousSessionId) {
            this.logReconnection(`Sending explicit reconnection notification`, {
                previousSessionId: this.previousSessionId,
                newSessionId: this.sessionId,
                playerId: this.playerId
            });
            
            this.socket.emit('playerReconnected', {
                previousSessionId: this.previousSessionId,
                newSessionId: this.sessionId,
                name: this.playerName,
                characterType: this.characterType
            });
        }
        
        // Immediately request existing players
        setTimeout(() => {
            this.logReconnection(`Requesting existing players immediately after registration`);
            this.socket.emit('requestExistingPlayers');
            
            // Reset reconnection flag after complete registration process
            if (isReconnecting) {
                this.logReconnection(`Reconnection process completed, resetting flag`);
                this.isReconnecting = false;
            }
        }, 500);
    }
    
    /**
     * Sends a respawn event to the server
     */
    respawnPlayer(position) {
        if (!this.connected) return;
        
        this.log(`Sending respawn event to server at position (${position.x}, ${position.y}, ${position.z})`);
        this.socket.emit('playerRespawn', { position });
    }
    
    /**
     * Sends an attack event to the server
     */
    sendAttack(attackData) {
        if (!this.connected) return;
        
        // Log the attack data for debugging
        console.log('[MultiplayerManager] Sending attack to server:', attackData);
        
        // Ensure attackData exists and has required properties
        if (!attackData) {
            console.error('[MultiplayerManager] Attack data is null or undefined, creating default data');
            attackData = {
                position: { x: 0, y: 0, z: 0 },
                direction: { x: 0, y: 0, z: 1 },
                swordType: this.playerCharacter ? this.playerCharacter.swordType : 'broadsword',
                damage: 10,
                hitPlayers: []
            };
        }
        
        // Verify the data structure to prevent server errors and sanitize null values
        const sanitizedData = {
            position: {
                x: (attackData.position && typeof attackData.position.x === 'number') ? attackData.position.x : 0,
                y: (attackData.position && typeof attackData.position.y === 'number') ? attackData.position.y : 0,
                z: (attackData.position && typeof attackData.position.z === 'number') ? attackData.position.z : 0
            },
            direction: {
                x: (attackData.direction && typeof attackData.direction.x === 'number') ? attackData.direction.x : 0,
                y: (attackData.direction && typeof attackData.direction.y === 'number') ? attackData.direction.y : 0,
                z: (attackData.direction && typeof attackData.direction.z === 'number') ? attackData.direction.z : 1
            },
            swordType: attackData.swordType || (this.playerCharacter ? this.playerCharacter.swordType : 'broadsword'),
            damage: typeof attackData.damage === 'number' ? attackData.damage : 10,
            hitPlayers: Array.isArray(attackData.hitPlayers) ? attackData.hitPlayers : []
        };
        
        console.log('[MultiplayerManager] Sanitized attack data:', sanitizedData);
        
        // Send the attack event to the server
        this.socket.emit('playerAttack', sanitizedData);
    }
    
    /**
     * Updates the player's position on the server
     */
    updatePosition() {
        if (!this.connected || !this.game.playerCharacter) return;
        
        const character = this.game.playerCharacter;
        const position = character.mesh.position;
        const rotation = character.mesh.rotation.y;
        
        // Make sure our character type is updated - in case it changed
        if (character.type && this.characterType !== character.type) {
            this.characterType = character.type;
            this.log(`Character type updated to ${this.characterType}`);
        }
        
        // Make sure our sword type is updated - in case it changed
        if (character.swordType && this.swordType !== character.swordType) {
            this.swordType = character.swordType;
            this.log(`Sword type updated to ${this.swordType}`);
        }
        
        // Make sure our player name is updated - in case it changed
        if (this.game.playerName && this.playerName !== this.game.playerName) {
            this.playerName = this.game.playerName;
            this.log(`Player name updated to ${this.playerName}`);
        }
        
        // Calculate movement delta
        let delta = 0;
        if (this.lastPosition) {
            // Calculate distance moved since last update
            const dx = position.x - this.lastPosition.x;
            const dy = position.y - this.lastPosition.y;
            const dz = position.z - this.lastPosition.z;
            delta = Math.sqrt(dx*dx + dy*dy + dz*dz);
        }
        
        // Get current time for time-based checks
        const now = Date.now();
        
        // Increase update frequency: Force updates every 1 second instead of 3
        const forceUpdate = !this._lastPositionUpdateTime || (now - this._lastPositionUpdateTime > 1000);
        
        // Reduce movement threshold to send updates more frequently
        const minMovementThreshold = 0.02; // Reduced from 0.05 to be more responsive
        const shouldUpdate = !this.lastPosition || 
                            delta > minMovementThreshold ||
                            Math.abs(this.lastRotation - rotation) > 0.05 || // Only update on significant rotation changes 
                            forceUpdate;
        
        if (!shouldUpdate) return;
        
        // Remember update time
        this._lastPositionUpdateTime = now;
        
        // Logging for movement debugging
        if (forceUpdate) {
            this.logReconnection(`Sending forced position update: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}), rotation: ${rotation.toFixed(2)}`);
        } else if (!this._lastPositionLog || now - this._lastPositionLog > 5000) { // log every 5 seconds max
            this.log(`Sending position update: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}), rotation: ${rotation.toFixed(2)}`);
            if (delta > 0) {
                this.log(`Movement delta: ${delta.toFixed(2)} units`);
            }
            this._lastPositionLog = now;
        }
        
        // Remember last position for next comparison
        this.lastPosition = {
            x: position.x,
            y: position.y,
            z: position.z
        };
        this.lastRotation = rotation;
        
        // Generate unique update ID
        const updateId = `${now}_${Math.random().toString(36).substring(2, 7)}`;
        
        // Send update to server with debugging information
        this.socket.emit('playerUpdate', {
            id: this.socket.id,
            name: this.playerName || character.name,
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            },
            rotation: rotation,
            characterType: this.characterType, // Include character type in every update
            swordType: this.swordType, // Include sword type in every update
            timestamp: now,
            updateId: updateId, // Help track updates in logs
            debug: {
                delta: delta,
                isForced: forceUpdate
            }
        });
        
        // Verify update was received (only occasionally)
        if (Math.random() < 0.1) { // 10% of updates
            // Request server status after a short delay to verify update
            setTimeout(() => {
                if (this.socket && this.socket.connected) {
                    this.socket.emit('ping', { timestamp: now });
                }
            }, 500);
        }
    }
    
    /**
     * Add a remote player to the game
     * @param {object} playerData - The player data
     * @returns {object|null} - The created remote player, or null if player already exists
     */
    addRemotePlayer(playerData) {
        try {
            if (!playerData || !playerData.id) {
                this.log('Cannot add remote player: invalid player data');
                return null;
            }
            
            // Check if this player already exists
            if (this.remotePlayers[playerData.id]) {
                // Player already exists, just update their data
                const existingPlayer = this.remotePlayers[playerData.id];
                
                // Log if their name has changed
                if (playerData.name && existingPlayer.name !== playerData.name) {
                    this.log(`Remote player ${playerData.id} name changed from "${existingPlayer.name}" to "${playerData.name}"`);
                    existingPlayer.name = playerData.name;
                    
                    // Update the name tag if the mesh exists
                    if (this.game && this.game.scene) {
                        let playerMesh = null;
                        this.game.scene.traverse(obj => {
                            if (obj.name === `player_${playerData.id}`) {
                                playerMesh = obj;
                            }
                        });
                        if (playerMesh) {
                            this.createNameTag(playerData.id, existingPlayer);
                        }
                    }
                }
                
                return existingPlayer;
            }
            
            // Create a new player object with all required properties
            const player = {
                id: playerData.id,
                name: playerData.name || `Player_${playerData.id.substring(0, 5)}`,
                characterType: playerData.characterType || 'knight',
                swordType: playerData.swordType || 'broadsword',
                health: typeof playerData.health === 'number' ? playerData.health : 100,
                position: playerData.position || { x: 0, y: 0, z: 0 },
                rotation: playerData.rotation || 0,
                isAttacking: !!playerData.isAttacking,
                isBlocking: !!playerData.isBlocking,
                lastUpdateTime: Date.now(),
                _lastUpdateTime: Date.now()
            };
            
            // Add detailed logging when adding a remote player
            this.log(`Adding remote player: ${player.name} (${player.id}) - Character: ${player.characterType}, Position: ${JSON.stringify(player.position)}`);
            
            // Add to remote players dictionary
            this.remotePlayers[playerData.id] = player;
            
            // Create visual representation if game is initialized and we have a scene
            if (!this.game || !this.game.scene) {
                this.logReconnection(`WARNING: Cannot create visual player - no game or scene available`, {
                    gameExists: !!this.game,
                    sceneExists: !!(this.game && this.game.scene)
                });
                
                // If there's a global game instance available, try to use that
                if (window.gameInstance && window.gameInstance.scene) {
                    this.logReconnection(`Attempting to use global game instance for mesh creation`);
                    this.game = window.gameInstance;
                    return this.addRemotePlayer(playerData); // Retry with the global instance
                }
                
                // Schedule a delayed retry to create the mesh once the game might be available
                setTimeout(() => {
                    if (!this.game || !this.game.scene) {
                        // Still no game, try to use any global instance
                        if (window.gameInstance && window.gameInstance.scene) {
                            this.logReconnection(`Using delayed global game instance for mesh creation`);
                            this.initialize(window.gameInstance);
                        } else {
                            this.logReconnection(`Still no game available after delay - cannot create player mesh`);
                        }
                    } else {
                        // Check if player mesh exists using Three.js methods
                        let meshExists = false;
                        this.game.scene.traverse(obj => {
                            if (obj.name === `player_${playerData.id}`) {
                                meshExists = true;
                            }
                        });
                        
                        if (!meshExists) {
                        // Game is now available but player mesh doesn't exist yet
                        this.logReconnection(`Game now available - creating delayed mesh for player ${playerData.name}`);
                            this.createRemotePlayerMesh(playerData.id, this.remotePlayers[playerData.id]);
                            this.createNameTag(playerData.id, this.remotePlayers[playerData.id]);
                        }
                    }
                }, 1000);
                
                return this.remotePlayers[playerData.id]; // Return player data even without visuals
            }
            
            // Create a mesh for this player
            const playerMesh = this.createRemotePlayerMesh(playerData.id, this.remotePlayers[playerData.id]);
            if (!playerMesh) {
                this.logReconnection(`WARNING: Failed to create mesh for player ${playerData.id}`);
                return this.remotePlayers[playerData.id]; // Return player data even without visuals
            }
            
            // Create a name tag for this player
            this.createNameTag(playerData.id, this.remotePlayers[playerData.id]);
            
            // Update player count
            this.updatePlayerCount();
            
            this.logReconnection(`Successfully added remote player`, {
                id: playerData.id,
                name: this.remotePlayers[playerData.id].name,
                meshCreated: !!playerMesh,
                position: this.remotePlayers[playerData.id].position
            });
            
            // Perform visibility check after short delay to ensure rendering
            setTimeout(() => {
                // Find the mesh in the scene
                let mesh = null;
                let nameTag = null;
                
                if (this.game && this.game.scene) {
                    this.game.scene.traverse(obj => {
                        if (obj.name === `player_${playerData.id}`) {
                            mesh = obj;
                        } else if (obj.name === `nameTag_${playerData.id}`) {
                            nameTag = obj;
                        }
                    });
                }
                
                this.logReconnection(`Player visibility check`, {
                    id: playerData.id,
                    meshVisible: mesh ? mesh.visible : false,
                    nameTagVisible: nameTag ? nameTag.visible : false,
                    meshPosition: mesh ? {
                        x: mesh.position.x,
                        y: mesh.position.y,
                        z: mesh.position.z
                    } : null
                });
                
                // If mesh exists but isn't visible, try to make it visible
                if (mesh && !mesh.visible) {
                    mesh.visible = true;
                    this.logReconnection(`Forced visibility for player mesh`, { id: playerData.id });
                }
                
                if (nameTag && !nameTag.visible) {
                    nameTag.visible = true;
                    this.logReconnection(`Forced visibility for player name tag`, { id: playerData.id });
                }
                
                // Make sure player position is updated
                if (mesh && this.remotePlayers[playerData.id]) {
                    const position = this.remotePlayers[playerData.id].position;
                    mesh.position.set(
                        position.x || 0,
                        position.y || 0,
                        position.z || 0
                    );
                }
            }, 500);
            
            this.logReconnection(`Added remote player ${playerData.name} (${playerData.id})`, {
                characterType: this.remotePlayers[playerData.id].characterType,
                position: this.remotePlayers[playerData.id].position,
                socketId: playerData.id
            });
            
            return this.remotePlayers[playerData.id];
            
        } catch (error) {
            this.logReconnection(`Error adding remote player`, { 
                error: error.message,
                stack: error.stack, 
                playerData: playerData ? {
                    id: playerData.id,
                    name: playerData.name
                } : 'null'
            });
            return null;
        }
    }
    
    /**
     * Create a mesh for a remote player
     * @param {string} playerId - The ID of the player
     * @param {object} playerData - The player data
     * @returns {object|null} - The created mesh or null if failed
     */
    createRemotePlayerMesh(playerId, playerData) {
        try {
            if (!this.game || !this.game.scene) {
                this.logReconnection(`Cannot create player mesh - no game or scene`, {
                    id: playerId
                });
                return null;
            }
            
            // Check if mesh already exists - use Three.js methods to find objects by name
            let existingMesh = null;
            this.game.scene.traverse(obj => {
                if (obj.name === `player_${playerId}`) {
                    existingMesh = obj;
                }
            });
            
            if (existingMesh) {
                this.logReconnection(`Player mesh already exists, using existing mesh`, {
                    id: playerId
                });
                return existingMesh;
            }
            
            // Create character based on type
            const character = this.createCharacterByType(playerId, playerData.characterType);
            if (!character) {
                this.logReconnection(`Failed to create character for player ${playerId}`);
                return null;
            }
            
            // Set position and rotation
            character.position.x = playerData.position.x || 0;
            character.position.y = playerData.position.y || 0;
            character.position.z = playerData.position.z || 0;
            character.rotation.y = playerData.rotation || 0;
            
            // Make sure it's visible
            character.visible = true; // Three.js uses visible instead of isVisible
            
            this.logReconnection(`Created player mesh`, {
                id: playerId,
                type: playerData.characterType,
                position: {
                    x: character.position.x,
                    y: character.position.y,
                    z: character.position.z
                }
            });
            
            return character;
            
        } catch (error) {
            this.logReconnection(`Error creating player mesh`, {
                error: error.message,
                playerId
            });
            return null;
        }
    }
    
    /**
     * Create a character mesh based on type
     * @param {string} playerId - The ID of the player
     * @param {string} characterType - The type of character
     * @returns {object|null} - The created character mesh or null if failed
     */
    createCharacterByType(playerId, characterType) {
        try {
            if (!this.game || !this.game.scene) {
                this.logReconnection(`Cannot create character - no game or scene`, {
                    id: playerId
                });
                return null;
            }
            
            // Check if mesh already exists - if so, return it
            let existingMesh = null;
            this.game.scene.children.forEach(child => {
                if (child.name === `player_${playerId}`) {
                    existingMesh = child;
                }
            });
            
            if (existingMesh) {
                this.logReconnection(`Player mesh already exists, using existing mesh`, {
                    id: playerId
                });
                return existingMesh;
            }
            
            // Create a minecraft-like character with body and limbs
            // Group to hold all character parts
            const characterGroup = new THREE.Group();
            characterGroup.name = `player_${playerId}`;
            
            // Determine character color based on type
            let color;
            switch (characterType) {
                case 'knight':
                    color = new THREE.Color(0x0055FF); // Bright blue for knight
                    break;
                case 'ninja':
                    color = new THREE.Color(0x000000); // Pure black for ninja
                    break;
                case 'samurai':
                    color = new THREE.Color(0xFF0000); // Bright red for samurai
                    break;
                default:
                    color = new THREE.Color(0x777777); // Gray
            }
            
            // Create a material for the player
            const material = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.5, // Lower roughness for more vibrant colors
                metalness: 0.2  // Lower metalness for more solid Minecraft-like colors
            });
            
            // Create head (slightly smaller than body)
            const headGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            const headMesh = new THREE.Mesh(headGeometry, material);
            headMesh.position.set(0, 1.4, 0);
            headMesh.castShadow = true;
            characterGroup.add(headMesh);
            
            // Create body (torso)
            const bodyGeometry = new THREE.BoxGeometry(0.9, 1.2, 0.5);
            const bodyMesh = new THREE.Mesh(bodyGeometry, material);
            bodyMesh.position.set(0, 0.5, 0);
            bodyMesh.castShadow = true;
            characterGroup.add(bodyMesh);
            
            // Create arms (slightly darker shade for contrast)
            const armMaterial = material.clone();
            armMaterial.color.multiplyScalar(0.9); // Slightly darker
            
            // Left arm
            const leftArmGeometry = new THREE.BoxGeometry(0.4, 1.2, 0.4);
            const leftArmMesh = new THREE.Mesh(leftArmGeometry, armMaterial);
            leftArmMesh.position.set(-0.65, 0.5, 0);
            leftArmMesh.castShadow = true;
            characterGroup.add(leftArmMesh);
            
            // Right arm
            const rightArmGeometry = new THREE.BoxGeometry(0.4, 1.2, 0.4);
            const rightArmMesh = new THREE.Mesh(rightArmGeometry, armMaterial);
            rightArmMesh.position.set(0.65, 0.5, 0);
            rightArmMesh.castShadow = true;
            characterGroup.add(rightArmMesh);
            
            // Create legs (slightly darker shade than body)
            const legMaterial = material.clone();
            legMaterial.color.multiplyScalar(0.8); // Darker than arms
            
            // Left leg
            const leftLegGeometry = new THREE.BoxGeometry(0.4, 1.0, 0.4);
            const leftLegMesh = new THREE.Mesh(leftLegGeometry, legMaterial);
            leftLegMesh.position.set(-0.25, -0.6, 0);
            leftLegMesh.castShadow = true;
            characterGroup.add(leftLegMesh);
            
            // Right leg
            const rightLegGeometry = new THREE.BoxGeometry(0.4, 1.0, 0.4);
            const rightLegMesh = new THREE.Mesh(rightLegGeometry, legMaterial);
            rightLegMesh.position.set(0.25, -0.6, 0);
            rightLegMesh.castShadow = true;
            characterGroup.add(rightLegMesh);
            
            // Set initial position
            characterGroup.position.set(0, 1, 0);
            
            // Add to scene
            this.game.scene.add(characterGroup);
            
            // Add a sword
            this.createSword(playerId, characterGroup);
            
            this.logReconnection(`Created Minecraft-style character for player`, {
                id: playerId,
                type: characterType
            });
            
            return characterGroup;
            
        } catch (error) {
            this.logReconnection(`Error creating character by type`, {
                error: error.message,
                playerId,
                characterType
            });
            return null;
        }
    }
    
    /**
     * Create a sword for a player
     * @param {string} playerId - The ID of the player
     * @param {object} parentMesh - The parent mesh to attach the sword to
     * @returns {object|null} - The created sword mesh or null if failed
     */
    createSword(playerId, parentMesh) {
        try {
            // Remove existing sword if any
            parentMesh.children.forEach(child => {
                if (child.name === `sword_${playerId}`) {
                    parentMesh.remove(child);
                }
            });
            
            // Get the player data to determine sword color based on character type
            const playerData = this.remotePlayers[playerId];
            const characterType = playerData ? playerData.characterType : 'default';
            
            // Create a Minecraft-like sword using THREE.js
            // Minecraft swords are more blocky and have a distinctive shape
            const handleGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.6);
            const bladeGeometry = new THREE.BoxGeometry(0.25, 0.1, 1.2);
            
            // Color the sword based on character type
            let swordColor;
            switch (characterType) {
                case 'knight':
                    swordColor = new THREE.Color(0x00AAFF); // Blue sword for knight
                    break;
                case 'ninja':
                    swordColor = new THREE.Color(0x444444); // Dark gray sword for ninja
                    break;
                case 'samurai':
                    swordColor = new THREE.Color(0xFF4444); // Red sword for samurai
                    break;
                default:
                    swordColor = new THREE.Color(0xCCCCCC); // Default silver
            }
            
            // Create the sword materials
            const handleMaterial = new THREE.MeshStandardMaterial({
                color: 0x8B4513, // Brown wooden handle
                roughness: 0.8,
                metalness: 0.1
            });
            
            const bladeMaterial = new THREE.MeshStandardMaterial({
                color: swordColor,
                roughness: 0.3,
                metalness: 0.7
            });
            
            // Create the sword parts
            const handleMesh = new THREE.Mesh(handleGeometry, handleMaterial);
            handleMesh.position.set(0, 0, -0.3); // Position the handle
            
            const bladeMesh = new THREE.Mesh(bladeGeometry, bladeMaterial);
            bladeMesh.position.set(0, 0, 0.6); // Position the blade in front of the handle
            
            // Create a group to hold both parts
            const swordGroup = new THREE.Group();
            swordGroup.name = `sword_${playerId}`;
            swordGroup.add(handleMesh);
            swordGroup.add(bladeMesh);
            
            // Position the sword relative to the player
            // For Minecraft-style, we want to position it near the right arm
            swordGroup.position.set(0.65, 0.5, 0.4);
            // Rotate the sword to be held properly
            swordGroup.rotation.set(0, Math.PI/2, 0); 
            
            // Add to parent mesh
            parentMesh.add(swordGroup);
            
            this.logReconnection(`Created Minecraft-style sword for player ${playerId}`);
            
            return swordGroup;
            
                    } catch (error) {
            this.logReconnection(`Error creating sword`, {
                error: error.message,
                playerId
            });
            return null;
        }
    }
    
    /**
     * Create a name tag for a player
     * @param {string} playerId - The ID of the player
     * @param {object} playerData - The player data
     * @returns {object|null} - The created name tag or null if failed
     */
    createNameTag(playerId, playerData) {
        try {
            if (!this.game || !this.game.scene) {
                this.logReconnection(`Cannot create name tag - no game or scene`, {
                    id: playerId
                });
                return null;
            }
            
            // Find the player mesh
            let playerMesh = null;
            this.game.scene.children.forEach(child => {
                if (child.name === `player_${playerId}`) {
                    playerMesh = child;
                }
            });
            
            if (!playerMesh) {
                this.logReconnection(`Cannot create name tag - player mesh not found`, {
                    id: playerId
                });
                return null;
            }
            
            // Remove existing name tag if any
            playerMesh.children.forEach(child => {
                if (child.name === `nameTag_${playerId}`) {
                    playerMesh.remove(child);
                }
            });
            
            // Create a canvas to draw the name
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            
            // Create Minecraft-style name tag with semi-transparent background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw border like a Minecraft name tag
            ctx.strokeStyle = 'rgb(80, 80, 80)';
            ctx.lineWidth = 4;
            ctx.strokeRect(2, 2, canvas.width-4, canvas.height-4);
            
            // Draw player name in Minecraft style
            ctx.fillStyle = 'white';
            ctx.font = 'bold 32px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(playerData.name, canvas.width / 2, canvas.height / 2);
            
            // Create a texture from the canvas
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            
            // Create a plane for the name tag
            const nameTagGeometry = new THREE.PlaneGeometry(1, 0.25);
            const nameTagMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                side: THREE.DoubleSide
            });
            
            const nameTagMesh = new THREE.Mesh(nameTagGeometry, nameTagMaterial);
            nameTagMesh.name = `nameTag_${playerId}`;
            
            // Position the name tag above the player's head
            // Adjusted for Minecraft-style character with head at the top
            nameTagMesh.position.set(0, 2.3, 0);
            
            // Make the name tag always face the camera
            if (this.game.camera) {
                nameTagMesh.userData.camera = this.game.camera;
            }
            
            // Add to player mesh
            playerMesh.add(nameTagMesh);
            
            this.logReconnection(`Created Minecraft-style name tag for player ${playerId}`);
            
            return nameTagMesh;
            
        } catch (error) {
            this.logReconnection(`Error creating name tag`, {
                error: error.message,
                playerId
            });
            return null;
        }
    }
    
    /**
     * Removes a remote player from the scene
     */
    removeRemotePlayer(playerId, isReconnection = false) {
        try {
            if (!this.remotePlayers[playerId]) {
                if (isReconnection) {
                    this.logReconnection(`Cannot remove remote player - player ${playerId} not found during reconnection`);
                } else {
                    this.log(`Cannot remove remote player - player ${playerId} not found`);
                }
                return;
            }

            // Get reference to player before removal for logging
            const playerName = this.remotePlayers[playerId].name || 'Unknown';
            
            // Remove the player's mesh from the scene
            if (this.game && this.game.scene) {
                // Find all meshes related to this player by name
                const meshesToRemove = [];
                this.game.scene.traverse(obj => {
                    if (obj.name === `player_${playerId}` ||
                        obj.name === `sword_${playerId}` ||
                        obj.name === `nameTag_${playerId}`) {
                        meshesToRemove.push(obj);
                    }
                });
                
                // Remove meshes from scene
                meshesToRemove.forEach(mesh => {
                    this.logReconnection(`Removing mesh ${mesh.name}`);
                    if (mesh.parent) {
                        mesh.parent.remove(mesh);
                    } else {
                        this.game.scene.remove(mesh);
                    }
                    
                    // Also dispose of geometries and materials
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach(mat => mat.dispose());
                        } else {
                            mesh.material.dispose();
                        }
                    }
                });
            }
            
            // Delete the player from our remotePlayers object
            delete this.remotePlayers[playerId];
            
            if (isReconnection) {
                this.logReconnection(`Removed remote player during reconnection`, { 
                    id: playerId, 
                    name: playerName,
                    remainingPlayers: Object.keys(this.remotePlayers).length
                });
            } else {
                this.log(`Removed remote player ${playerName} (${playerId})`);
            }
            
            // Update the player count display
            this.updatePlayerCount();
            
        } catch (error) {
            if (isReconnection) {
                this.logReconnection(`Error removing remote player during reconnection`, { 
                    id: playerId, 
                    error: error.message 
                });
            } else {
                this.log(`Error removing remote player ${playerId}: ${error.message}`);
            }
        }
    }
    
    /**
     * Updates an existing remote player with new data
     */
    updateRemotePlayer(playerData) {
        if (!playerData || !playerData.id) {
            this.log('Cannot update remote player: invalid player data');
            return;
        }
        
        const remotePlayer = this.remotePlayers[playerData.id];
        
        if (!remotePlayer) {
            this.log(`Cannot update remote player ${playerData.id}: player not found in remotePlayers list`);
            return;
        }
        
        // Record the last update time for ghost detection
        remotePlayer._lastUpdateTime = Date.now();
        
        // Check if name has been updated - important for name tag updates
        let nameChanged = false;
        if (playerData.name && playerData.name !== remotePlayer.name) {
            this.log(`Player ${playerData.id} name updated from "${remotePlayer.name}" to "${playerData.name}"`);
            remotePlayer.name = playerData.name;
            nameChanged = true;
        }
        
        // Find the player mesh in the scene
        let playerMesh = null;
        if (this.game && this.game.scene) {
            this.game.scene.traverse(obj => {
                if (obj.name === `player_${playerData.id}`) {
                    playerMesh = obj;
                }
            });
        }
        
        // If no mesh exists but we have valid game and scene, try to create it
        if (!playerMesh && this.game && this.game.scene) {
            this.logReconnection(`Player ${playerData.id} mesh doesn't exist, creating it now`);
            playerMesh = this.createRemotePlayerMesh(playerData.id, remotePlayer);
            
            if (playerMesh) {
                this.createNameTag(playerData.id, remotePlayer);
                // Always make sure newly created meshes are visible
                playerMesh.visible = true;
            }
        }
        
        // If name changed, update the name tag
        if (nameChanged && playerMesh) {
            this.log(`Updating name tag for player ${playerData.id} to "${playerData.name}"`);
            this.createNameTag(playerData.id, remotePlayer);
        }
        
        // Ensure mesh is visible unless player is defeated
        if (playerMesh && (typeof remotePlayer.health !== 'number' || remotePlayer.health > 0)) {
            // Only set to visible if it wasn't already
            if (!playerMesh.visible) {
                playerMesh.visible = true;
            }
        }
        
        // Update position if provided
        if (playerData.position && playerMesh) {
            // Only update position if values are valid numbers
            const newPos = playerData.position;
            
            // First check if position values are present
            if (newPos && typeof newPos === 'object') {
                // Do more careful validation of position values
                const validX = typeof newPos.x === 'number' && !isNaN(newPos.x) && isFinite(newPos.x);
                const validY = typeof newPos.y === 'number' && !isNaN(newPos.y) && isFinite(newPos.y);
                const validZ = typeof newPos.z === 'number' && !isNaN(newPos.z) && isFinite(newPos.z);
                
                if (validX && validY && validZ) {
                    // Store the target position - instead of immediately updating
                    if (!remotePlayer.targetPosition) {
                        remotePlayer.targetPosition = { x: 0, y: 0, z: 0 };
                    }
                    remotePlayer.targetPosition.x = newPos.x;
                    remotePlayer.targetPosition.y = newPos.y;
                    remotePlayer.targetPosition.z = newPos.z;
                    
                    // If this is the first update or a large movement, snap directly
                    if (!remotePlayer.position || 
                        Math.abs(playerMesh.position.x - newPos.x) > 5 ||
                        Math.abs(playerMesh.position.y - newPos.y) > 5 ||
                        Math.abs(playerMesh.position.z - newPos.z) > 5) {
                        
                playerMesh.position.set(newPos.x, newPos.y, newPos.z);
                
                        // Also update our stored position
                        if (!remotePlayer.position) {
                            remotePlayer.position = { x: 0, y: 0, z: 0 };
                        }
                        remotePlayer.position.x = newPos.x;
                        remotePlayer.position.y = newPos.y;
                        remotePlayer.position.z = newPos.z;
                        
                        // Update position for sword and name tag as well
                        this.updateRelatedMeshPositions(playerData.id, newPos);
                        
                        // Log snapping
                        this.log(`Snapped player ${playerData.id} to position (${newPos.x.toFixed(2)}, ${newPos.y.toFixed(2)}, ${newPos.z.toFixed(2)})`);
                    }
                    
                    // Store the last received server update time for interpolation
                    remotePlayer.lastPositionUpdateTime = Date.now();
                    
                } else {
                    this.log(`Remote player ${playerData.id} sent invalid position coordinates`, {
                        x: { value: newPos.x, valid: validX },
                        y: { value: newPos.y, valid: validY },
                        z: { value: newPos.z, valid: validZ }
                    });
                }
                        } else {
                this.log(`Remote player ${playerData.id} sent invalid position data: ${JSON.stringify(newPos)}`);
            }
        }
        
        // Update sword type if it has changed
        if (playerData.swordType && remotePlayer.swordType !== playerData.swordType) {
            this.log(`Remote player ${playerData.id} switched sword to ${playerData.swordType}`);
            
            // Update the stored sword type
            remotePlayer.swordType = playerData.swordType;
            
            // Update the sword visually if we have a player mesh
            if (playerMesh) {
                this.createSword(playerData.id, playerMesh);
            }
        }
        
        // Check if character type has changed and update it
        if (playerData.characterType && remotePlayer.characterType !== playerData.characterType) {
            this.log(`Remote player ${playerData.id} changed character type from ${remotePlayer.characterType || 'unknown'} to ${playerData.characterType}`);
            
            // Update stored character type
            remotePlayer.characterType = playerData.characterType;
            
            // We need to recreate the mesh with the new character type
            if (playerMesh) {
                // Remove old mesh from scene
                this.game.scene.remove(playerMesh);
                
                // Create new mesh with correct character type
                const newMesh = this.createRemotePlayerMesh(playerData.id, remotePlayer);
                
                if (newMesh) {
                    this.createNameTag(playerData.id, remotePlayer);
                    this.log(`Recreated mesh for player ${playerData.id} with character type ${playerData.characterType}`);
                }
            }
        }
        
        // Update rotation
        if (typeof playerData.rotation === 'number' && playerMesh) {
            // Update character rotation reference
            remotePlayer.rotation = playerData.rotation;
            
            // Update mesh rotation
            playerMesh.rotation.y = playerData.rotation;
        }
        
        // Update health
        if (typeof playerData.health === 'number') {
            remotePlayer.health = playerData.health;
            
            // If they've been defeated, hide their mesh
            if (playerData.health <= 0 && playerMesh) {
                playerMesh.visible = false;
            }
        }
    }
    
    /**
     * Handles a remote player's attack
     */
    handleRemotePlayerAttack(data) {
        try {
            // Add clear debug logging for attack events
            console.log(`🗡️ REMOTE ATTACK RECEIVED from player ${data?.id}`, data);
            
            // Validate input data
            if (!data || !data.id) {
                console.error('Received invalid attack data:', data);
                return;
            }
            
            const remotePlayer = this.remotePlayers[data.id];
            if (!remotePlayer) {
                console.error(`Unknown remote player ${data.id} attacked - ignoring`, { 
                    availablePlayers: Object.keys(this.remotePlayers) 
                });
                return;
            }
            
            console.log(`Remote player ${data.id} (${remotePlayer.name}) attacked with ${data.swordType || 'unknown weapon'}`);
            
            // Find the player mesh
            let playerMesh = null;
            if (this.game && this.game.scene) {
                this.game.scene.traverse(obj => {
                    if (obj.name === `player_${data.id}`) {
                        playerMesh = obj;
                    }
                });
            }
            
            if (!playerMesh) {
                console.error(`Cannot find player mesh for player ${data.id} - creating it`);
                playerMesh = this.createRemotePlayerMesh(data.id, remotePlayer);
                
                if (!playerMesh) {
                    console.error(`Failed to create player mesh for player ${data.id}`);
                    return;
                }
            }
            
            // CRITICAL FIX: Find the sword in the player mesh children
            let swordMesh = null;
            playerMesh.traverse((child) => {
                // Use startsWith to be more flexible in finding the sword
                if (child.name && child.name.startsWith(`sword_`)) {
                    swordMesh = child;
                    console.log(`Found sword for player ${data.id}: ${child.name}`);
                }
            });
            
            // If no sword found, create one
            if (!swordMesh) {
                console.log(`Creating missing sword for player ${data.id}`);
                swordMesh = this.createSword(data.id, playerMesh);
                
                if (!swordMesh) {
                    console.error(`Failed to create sword for player ${data.id}`);
                    
                    // Last resort - create a basic sword
                    const tempSwordGeometry = new THREE.BoxGeometry(0.1, 0.1, 1);
                    const tempSwordMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
                    swordMesh = new THREE.Mesh(tempSwordGeometry, tempSwordMaterial);
                    swordMesh.name = `sword_${data.id}`;
                    playerMesh.add(swordMesh);
                }
            }
            
            // Make sure the sword is visible
            if (swordMesh) {
                swordMesh.visible = true;
                
                // Store the sword reference on the remote player object for easier access
                remotePlayer.sword = swordMesh;
            } else {
                console.error(`Could not find or create sword for player ${data.id}`);
                return;
            }
            
            // Update the remote player's sword type if it's included in the attack data
            if (data.swordType && remotePlayer.swordType !== data.swordType) {
                console.log(`Updating sword type for player ${data.id} from ${remotePlayer.swordType} to ${data.swordType}`);
                remotePlayer.swordType = data.swordType;
                
                // Recreate the sword with the correct type
                this.createSword(data.id, playerMesh);
                
                // Update the sword reference
                playerMesh.traverse((child) => {
                    if (child.name && child.name.startsWith(`sword_`)) {
                        swordMesh = child;
                        remotePlayer.sword = child;
                    }
                });
            }
            
            // Create a dramatic attack effect at the player's position
            this.createAttackEffect(playerMesh.position, data.direction);
            
            // Animate the sword swing with the fixed sword reference
            if (remotePlayer.sword) {
                console.log(`Animating sword swing for player ${data.id}`);
                this.animateRemotePlayerAttack(remotePlayer, data);
            } else {
                console.error(`Cannot animate attack - sword reference missing after all attempts`);
            }
            
            // Check if our character was hit
            const hitPlayers = Array.isArray(data.hitPlayers) ? data.hitPlayers : [];
            if (this.game.playerCharacter && this.socket && hitPlayers.includes(this.socket.id)) {
                console.log(`We were hit by player ${data.id}!`);
                
                // Apply damage
                let damage = data.damage || 10;
                if (typeof this.game.playerCharacter.takeDamage === 'function') {
                    this.game.playerCharacter.takeDamage(damage, data.id);
                }
                
                // Play hit sound
                try {
                    const hitSound = new Audio('hit.mp3');
                    hitSound.volume = 0.3;
                    hitSound.play().catch(e => console.error('Error playing hit sound:', e));
                } catch (e) {
                    console.error('Error with hit sound:', e);
                }
                
                // Show hit effect
                this.showHitEffect();
            }
        } catch (error) {
            console.error(`Error handling remote player attack:`, error);
            console.error('Attack data:', data);
            console.error('Stack trace:', error.stack);
        }
    }
    
    /**
     * Display a hit effect when player is attacked
     */
    showHitEffect() {
        // Create a red flash overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
        overlay.style.zIndex = '1000';
        overlay.style.pointerEvents = 'none';
        overlay.style.transition = 'opacity 0.5s';
        
        // Add to document
        document.body.appendChild(overlay);
        
        // Fade out and remove
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(overlay);
            }, 500);
        }, 100);
    }
    
    /**
     * Animate the remote player's sword swing
     * @param {Object} remotePlayer - The remote player object
     * @param {Object} attackData - The attack data from the server
     */
    animateRemotePlayerAttack(remotePlayer, attackData) {
        try {
            console.log('Starting remote player attack animation');
            
            if (!remotePlayer) {
                console.error('Cannot animate attack - remote player is null');
                return;
            }
            
            // Double check that we have the sword reference
            if (!remotePlayer.sword) {
                console.error('Cannot animate attack - sword not found on remote player object');
                
                // Try to find the sword in the player mesh
                if (this.game && this.game.scene) {
                    let playerMesh = null;
                    this.game.scene.traverse(obj => {
                        if (obj.name === `player_${attackData.id}`) {
                            playerMesh = obj;
                        }
                    });
                    
                    if (playerMesh) {
                        playerMesh.traverse(child => {
                            if (child.name && child.name.startsWith('sword_')) {
                                remotePlayer.sword = child;
                                console.log(`Found sword for animation: ${child.name}`);
                            }
                        });
                    }
                }
                
                // If we still don't have a sword, abort
                if (!remotePlayer.sword) {
                    return;
                }
            }
            
            // Force the sword to be visible
            remotePlayer.sword.visible = true;
            
            // Set player as attacking
            remotePlayer.isAttacking = true;
            remotePlayer.lastAttackTime = Date.now();
            
            // Store original sword position and rotation
            const originalRotation = {
                x: remotePlayer.sword.rotation.x || 0,
                y: remotePlayer.sword.rotation.y || 0,
                z: remotePlayer.sword.rotation.z || 0,
                posX: remotePlayer.sword.position.x || 0,
                posY: remotePlayer.sword.position.y || 0,
                posZ: remotePlayer.sword.position.z || 0
            };
            
            // Save original values to the player for use in animation
            remotePlayer.originalSwordRotation = originalRotation;
            
            console.log(`Starting sword animation for ${attackData.id} - original position:`, {
                rotation: {
                    x: originalRotation.x,
                    y: originalRotation.y,
                    z: originalRotation.z
                },
                position: {
                    x: originalRotation.posX,
                    y: originalRotation.posY,
                    z: originalRotation.posZ
                }
            });
            
            // Create an attack animation function with even more dramatic movement
            const animateSwing = () => {
                if (!remotePlayer.isAttacking || !remotePlayer.sword) {
                    console.log(`Animation stopped early - player no longer attacking or sword missing`);
                    return;
                }
                
                try {
                    const attackDuration = 600; // ms (longer for better visibility)
                    const attackProgress = (Date.now() - remotePlayer.lastAttackTime) / attackDuration;
                    
                    if (attackProgress < 1) {
                        // Split animation into phases
                        if (attackProgress < 0.2) {
                            // Wind-up phase - very exaggerated
                            const pullBackFactor = Math.sin(attackProgress / 0.2 * Math.PI/2);
                            remotePlayer.sword.rotation.x = originalRotation.x - Math.PI * 0.8 * pullBackFactor;
                            remotePlayer.sword.rotation.z = originalRotation.z + 0.7 * pullBackFactor;
                            remotePlayer.sword.position.y = originalRotation.posY + 0.3 * pullBackFactor;
                        } 
                        else if (attackProgress < 0.6) {
                            // Forward slash phase - extremely dramatic
                            const swingProgress = (attackProgress - 0.2) / 0.4; // normalize
                            const swingCurve = Math.sin(swingProgress * Math.PI);
                            
                            // Swing sword forward and down with extreme rotation
                            remotePlayer.sword.rotation.x = originalRotation.x - Math.PI * 0.8 + Math.PI * 1.6 * swingProgress;
                            remotePlayer.sword.rotation.z = originalRotation.z + 0.7 - (0.9 * swingProgress) + (swingCurve * 0.3);
                            
                            // Forward thrust during swing - very dramatic
                            const thrustAmount = Math.sin(swingProgress * Math.PI) * 1.5; // Tripled from original
                            remotePlayer.sword.position.z = originalRotation.posZ - thrustAmount;
                            
                            // Add extreme horizontal sweep - 90 degrees
                            const horizontalSweep = Math.sin(swingProgress * Math.PI) * 1.0; // Tripled
                            remotePlayer.sword.position.x = originalRotation.posX + horizontalSweep;
                            
                            // Add dramatic vertical movement
                            remotePlayer.sword.position.y = originalRotation.posY + 0.3 - (0.5 * swingProgress);
                        }
                        else {
                            // Recovery phase
                            const recoveryProgress = (attackProgress - 0.6) / 0.4;
                            const recoveryEase = 1 - Math.pow(1 - recoveryProgress, 2); // Ease out quad
                            
                            // Return to starting position
                            remotePlayer.sword.rotation.x = originalRotation.x + Math.PI * 0.8 - (Math.PI * 0.8 * recoveryEase);
                            remotePlayer.sword.rotation.z = originalRotation.z - 0.2 + (0.2 * recoveryEase);
                            
                            // Move position back
                            remotePlayer.sword.position.z = originalRotation.posZ - 0.5 + (0.5 * recoveryEase);
                            remotePlayer.sword.position.x = originalRotation.posX + 0.2 - (0.2 * recoveryEase);
                            remotePlayer.sword.position.y = originalRotation.posY - 0.2 + (0.2 * recoveryEase);
                        }
                        
                        // Continue animation loop
                        requestAnimationFrame(animateSwing);
                    } else {
                        // Animation complete, reset sword position
                        console.log(`Attack animation completed, resetting sword position`);
                        remotePlayer.sword.rotation.x = originalRotation.x;
                        remotePlayer.sword.rotation.y = originalRotation.y;
                        remotePlayer.sword.rotation.z = originalRotation.z;
                        
                        remotePlayer.sword.position.x = originalRotation.posX;
                        remotePlayer.sword.position.y = originalRotation.posY;
                        remotePlayer.sword.position.z = originalRotation.posZ;
                        
                        remotePlayer.isAttacking = false;
                    }
                } catch (animError) {
                    console.error(`Error during attack animation:`, animError);
                    // Reset state to avoid getting stuck
                    remotePlayer.isAttacking = false;
                }
            };
            
            // Start animation loop
            animateSwing();
            
        } catch (error) {
            console.error('Error in animateRemotePlayerAttack:', error);
            console.error('RemotePlayer:', remotePlayer?.id);
            console.error('AttackData:', attackData);
            // Reset state to avoid getting stuck
            if (remotePlayer) {
                remotePlayer.isAttacking = false;
            }
        }
    }
    
    /**
     * Create a visual effect for attacks
     * @param {Object} position - The position of the attack
     * @param {Object} direction - The direction of the attack
     */
    createAttackEffect(position, direction) {
        if (!this.game || !this.game.scene) {
            console.error('Cannot create attack effect - game or scene not available');
            return;
        }
        
        console.log('Creating attack effect at position:', position);
        
        // Create multiple attack effects for better visibility
        try {
            // 1. Create a larger, more visible slash effect
            const slashGeometry = new THREE.TorusGeometry(2, 0.2, 8, 16, Math.PI); // Larger torus
            const slashMaterial = new THREE.MeshBasicMaterial({
                color: 0xFF4500, // Bright orange-red
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide // Visible from both sides
            });
            const slashEffect = new THREE.Mesh(slashGeometry, slashMaterial);
            
            // 2. Add a glow effect using a second, larger torus
            const glowGeometry = new THREE.TorusGeometry(2.2, 0.5, 8, 16, Math.PI);
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: 0xFFFF00, // Bright yellow
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide
            });
            const glowEffect = new THREE.Mesh(glowGeometry, glowMaterial);
            
            // 3. Create a particle burst effect
            const particleCount = 20;
            const particleGeometry = new THREE.SphereGeometry(0.1, 8, 8);
            const particleMaterial = new THREE.MeshBasicMaterial({
                color: 0xFFFFFF, // White
                transparent: true,
                opacity: 0.7
            });
            
            const particles = [];
            for (let i = 0; i < particleCount; i++) {
                const particle = new THREE.Mesh(particleGeometry, particleMaterial.clone());
                // Random position within a small sphere around the attack point
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 1.5;
                particle.position.set(
                    Math.cos(angle) * radius,
                    Math.random() * 1.5 - 0.75,
                    Math.sin(angle) * radius
                );
                // Store random direction for animation
                particle.userData.direction = new THREE.Vector3(
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1,
                    Math.random() * 2 - 1
                ).normalize();
                particle.userData.speed = Math.random() * 0.1 + 0.05;
                particles.push(particle);
            }
            
            // Create a group to hold all effects
            const effectGroup = new THREE.Group();
            effectGroup.add(slashEffect);
            effectGroup.add(glowEffect);
            particles.forEach(p => effectGroup.add(p));
            
            // Position at attack location
            effectGroup.position.copy(position);
            effectGroup.position.y += 1.5; // Slightly higher to be more visible
            
            // Orient based on attack direction
            if (direction) {
                const angle = Math.atan2(direction.x, direction.z);
                effectGroup.rotation.y = angle;
            }
            
            // Rotate the slash to be vertical
            slashEffect.rotation.x = Math.PI / 2;
            glowEffect.rotation.x = Math.PI / 2;
            
            // Add to scene
            this.game.scene.add(effectGroup);
            
            // Animate the slash effect
            let opacity = 1.0;
            let scale = 1;
            
            const animateEffect = () => {
                // Reduce opacity
                opacity -= 0.035;
                
                // Increase scale
                scale += 0.06;
                
                // Update the slash and glow effects
                slashEffect.material.opacity = opacity;
                slashEffect.scale.set(scale, scale, 1);
                
                glowEffect.material.opacity = opacity * 0.5;
                glowEffect.scale.set(scale, scale, 1);
                
                // Animate particles
                particles.forEach(particle => {
                    const dir = particle.userData.direction;
                    const speed = particle.userData.speed;
                    particle.position.x += dir.x * speed;
                    particle.position.y += dir.y * speed;
                    particle.position.z += dir.z * speed;
                    particle.material.opacity = opacity;
                });
                
                if (opacity > 0) {
                    requestAnimationFrame(animateEffect);
                } else {
                    // Remove from scene when animation is complete
                    this.game.scene.remove(effectGroup);
                    
                    // Dispose of geometries and materials
                    slashGeometry.dispose();
                    slashMaterial.dispose();
                    glowGeometry.dispose();
                    glowMaterial.dispose();
                    particleGeometry.dispose();
                    particles.forEach(p => p.material.dispose());
                }
            };
            
            // Start animation
            animateEffect();
            
            console.log('Attack effect created and animating');
            
        } catch (error) {
            console.error('Error creating attack effect:', error);
        }
    }
    
    /**
     * Updates the player count display
     */
    updatePlayerCount(playerCount = Object.keys(this.remotePlayers).length + 1) {
        if (this.playerCountElement) {
            this.playerCountElement.textContent = `Players: ${playerCount}`;
        }
    }
    
    /**
     * Updates the connection status display
     * @param {string} status - The connection status
     * @param {string} message - Optional status message
     */
    updateConnectionStatus(status, message = '') {
        // Update the status indicators if they exist
        if (this.connectionStatusElement) {
            // Remove all status classes
            this.connectionStatusElement.classList.remove(
                'status-connecting', 
                'status-connected', 
                'status-verified', 
                'status-disconnected', 
                'status-error'
            );
            
            // Add the appropriate class
        this.connectionStatusElement.classList.add(`status-${status}`);
        
            // Update the text
            this.connectionStatusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
        
        // Update status message if the element exists
        if (this.statusMessageElement && message) {
            this.statusMessageElement.textContent = message;
        }
        
        // Also log the status change
        this.log(`Connection status: ${status}${message ? ` - ${message}` : ''}`);
    }
    
    /**
     * Logs a message to the debug console
     */
    log(message, data = null) {
        // Don't log anything if debug is hidden
        if (this.debugElement && this.debugElement.style.display === 'none') {
            // Skip all console logging when debug is disabled
            return;
        }
        
        // Skip certain verbose logs
        if (message.includes('position update') || 
            message.includes('moved') ||
            message.includes('rotation updated') ||
            message.includes('player visibility check') ||
            message.includes('player sync') ||
            message.includes('player is now visible') ||
            message.includes('Checking mesh visibility') ||
            message.includes('became visible') ||
            (typeof message === 'string' && message.startsWith('Player mesh visibility'))) {
            return; // Skip verbose position/movement logs
        }
        
        // Determine if this is an important message
        const isImportant = 
            message.includes('Player joined') ||
            message.includes('Player left') ||
            message.includes('Error') ||
            message.includes('error') ||
            message.includes('fail') ||
            message.includes('Fail') ||
            message.includes('WARNING') ||
            message.includes('warning') ||
            message.includes('connected') ||
            message.includes('Connected');
        
        // Only log important messages
        if (isImportant) {
            console.log(`[Multiplayer] ${message}`, data || '');
            
            // Append to debug element if it exists and is visible
            const timestamp = new Date().toLocaleTimeString();
            if (this.debugElement && this.debugElement.style.display !== 'none') {
            this.debugElement.innerHTML += `<div>[${timestamp}] ${message}</div>`;
            this.debugElement.scrollTop = this.debugElement.scrollHeight;
            }
        }
    }
    
    /**
     * Logs a reconnection-related event to a special log that's separate from debug logs
     * @param {string} message - The message to log
     * @param {object} [data] - Optional data to include with the log
     */
    logReconnection(message, data = null) {
        try {
            // We'll still store logs in arrays for developer debugging if needed,
            // but we won't output anything to the console or UI
            
            // Initialize both logs arrays if they don't exist yet
            if (!this._reconnectionLogs) {
                this._reconnectionLogs = [];
            }
            
            if (!this.reconnectionLogs) {
                this.reconnectionLogs = [];
            }
            
            // Create log entry and store it silently
        const logEntry = { 
                time: Date.now(),
                message: message || '(empty message)',
                data: data || null
            };
            
            // Store in log arrays for developer debugging purposes only
            if (Array.isArray(this._reconnectionLogs)) {
                this._reconnectionLogs.push(logEntry);
            } else {
                this._reconnectionLogs = [logEntry];
            }
            
            if (Array.isArray(this.reconnectionLogs)) {
        this.reconnectionLogs.push(logEntry);
            } else {
                this.reconnectionLogs = [logEntry];
            }
            
            // Trim logs if they get too long
            const maxLogs = 1000;
            if (Array.isArray(this.reconnectionLogs) && this.reconnectionLogs.length > maxLogs) {
                this.reconnectionLogs = this.reconnectionLogs.slice(-maxLogs);
            }
            if (Array.isArray(this._reconnectionLogs) && this._reconnectionLogs.length > maxLogs) {
                this._reconnectionLogs = this._reconnectionLogs.slice(-maxLogs);
            }
            
            // Only log to console for critical errors that would break the game
            // This is kept for emergency debugging purposes only
            if (message.includes('CRITICAL ERROR') || message.includes('FATAL')) {
                console.error(`[CRITICAL] ${message}`, data || '');
            }
            
            // We no longer update the debug element to avoid any visual elements
        } catch (err) {
            // Only log truly critical errors
            console.error("Critical error in log system:", err);
        }
    }
    
    /**
     * Export all reconnection logs as JSON string for debugging
     */
    exportReconnectionLogs() {
        return JSON.stringify(this.reconnectionLogs, null, 2);
    }
    
    /**
     * Updates the multiplayer system
     */
    update() {
        // Skip if not connected
        if (!this.connected) return;
        
        const now = Date.now();
        
        // Check for ghost players
        if (!this._lastGhostCheck || (now - this._lastGhostCheck > 30000)) {
            this._lastGhostCheck = now;
            this.cleanupGhostPlayers();
        }
        
        // Update our position on the server
        if (this.game && this.game.playerCharacter) {
        this.updatePosition();
        }
        
        // Apply interpolation to smooth out remote player movements
        this.interpolatePlayerPositions();
        
        // Update remote player animations and positions
        for (const id in this.remotePlayers) {
            const remotePlayer = this.remotePlayers[id];
            
            // Skip self
            if (id === this.socket.id) continue;
            
            // Skip if no game or scene
            if (!this.game || !this.game.scene) continue;
            
            // Find the player mesh and its nametag
            let playerMesh = null;
            let nameTag = null;
            let swordMesh = null;
            
            this.game.scene.traverse(obj => {
                if (obj.name === `player_${id}`) {
                    playerMesh = obj;
                } else if (obj.name === `nameTag_${id}`) {
                    nameTag = obj;
                } else if (obj.name === `sword_${id}`) {
                    swordMesh = obj;
                }
            });
            
            // If no player mesh found, try to create it
            if (!playerMesh) {
                // Only log this occasionally to avoid spam
                if (Math.random() < 0.1) {
                    this.log(`Missing player mesh for ${remotePlayer.name} (${id}), attempting to create`);
                }
                playerMesh = this.createRemotePlayerMesh(id, remotePlayer);
                if (playerMesh) {
                    this.createNameTag(id, remotePlayer);
                }
                continue; // Skip this iteration after creating
            }
            
            // Update name tag rotation to face camera
            if (this.game.camera) {
                // Find the name tag in the player mesh children
                let nameTag = null;
                if (playerMesh) {
                    playerMesh.children.forEach(child => {
                        if (child.name === `nameTag_${id}`) {
                            nameTag = child;
                        }
                    });
                }
                
                // Make name tag always face the camera
                if (nameTag) {
                nameTag.lookAt(this.game.camera.position);
                }
            }
            
            // Make sure positions are synced with stored data
                    if (remotePlayer.position) {
                // Verify the position values to avoid NaN errors
                const x = typeof remotePlayer.position.x === 'number' ? remotePlayer.position.x : 0;
                const y = typeof remotePlayer.position.y === 'number' ? remotePlayer.position.y : 0;
                const z = typeof remotePlayer.position.z === 'number' ? remotePlayer.position.z : 0;
                
                // Make sure the mesh position matches stored data
                if (playerMesh && (
                    Math.abs(playerMesh.position.x - x) > 0.01 || 
                    Math.abs(playerMesh.position.y - y) > 0.01 || 
                    Math.abs(playerMesh.position.z - z) > 0.01)) {
                    
                    playerMesh.position.set(x, y, z);
                    
                    // Log this for debugging
                    this.log(`Forced position sync for player ${id}: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
                }
            }
            
            // Check if player should be visible but isn't
            if (remotePlayer.health === undefined || remotePlayer.health > 0) {
                if (playerMesh && !playerMesh.visible) {
                    playerMesh.visible = true;
                    this.log(`Restored visibility for player ${remotePlayer.name} (${id})`);
                }
            }
        }
        
        // Periodically request latest player data
        if (!this._lastPlayersRequest || (now - this._lastPlayersRequest > 10000)) {
            if (this.socket && this.socket.connected) {
                this.socket.emit('requestExistingPlayers');
                this._lastPlayersRequest = now;
            }
        }
        
        // Periodically check for mesh/player consistency
        if (!this._lastConsistencyCheck || now - this._lastConsistencyCheck > 10000) {
            this._lastConsistencyCheck = now;
            
            // Count remote players and meshes
            const remotePlayerCount = Object.keys(this.remotePlayers).length;
            let playerMeshCount = 0;
            
            if (this.game && this.game.scene) {
                this.game.scene.traverse(obj => {
                    if (obj.name && obj.name.startsWith('player_') && 
                        !obj.name.includes('sword') && !obj.name.includes('nameTag')) {
                        playerMeshCount++;
                    }
                });
            }
            
            // Log any inconsistency
            if (playerMeshCount !== remotePlayerCount) {
                this.log(`Player consistency check: ${playerMeshCount} meshes vs ${remotePlayerCount} remote players`);
                
                // If significant mismatch, trigger refresh
                if (playerMeshCount < remotePlayerCount && playerMeshCount > 0) {
                    this.log(`Missing player meshes detected, forcing refresh`);
                    this.forceRefresh();
                }
            }
        }
    }
    
    /**
     * Display reconnection logs in a popup window for debugging
     */
    showReconnectionLogs() {
        // Create modal container
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.top = '50%';
        modal.style.left = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        modal.style.border = '1px solid #444';
        modal.style.borderRadius = '5px';
        modal.style.width = '90%';
        modal.style.maxWidth = '800px';
        modal.style.maxHeight = '80vh';
        modal.style.padding = '20px';
        modal.style.color = '#fff';
        modal.style.zIndex = '1000';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        
        // Add header
        const header = document.createElement('div');
        header.innerHTML = `<h2>Reconnection Logs (${this.reconnectionLogs.length})</h2>
                           <p>Local player: ${this.playerName} | Session ID: ${this.sessionId} | Previous Session: ${this.previousSessionId || 'N/A'}</p>`;
        header.style.marginBottom = '10px';
        modal.appendChild(header);
        
        // Add controls
        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.justifyContent = 'space-between';
        controls.style.marginBottom = '10px';
        
        const closeButton = document.createElement('button');
        closeButton.innerText = 'Close';
        closeButton.style.padding = '5px 10px';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = () => document.body.removeChild(modal);
        
        const exportButton = document.createElement('button');
        exportButton.innerText = 'Export Logs';
        exportButton.style.padding = '5px 10px';
        exportButton.style.cursor = 'pointer';
        exportButton.onclick = () => {
            const logData = this.exportReconnectionLogs();
            const blob = new Blob([logData], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reconnection_logs_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
        
        const clearButton = document.createElement('button');
        clearButton.innerText = 'Clear Logs';
        clearButton.style.padding = '5px 10px';
        clearButton.style.cursor = 'pointer';
        clearButton.onclick = () => {
            this.reconnectionLogs = [];
            this.logReconnection('Logs cleared by user');
            document.body.removeChild(modal);
            this.showReconnectionLogs(); // Reopen with cleared logs
        };
        
        controls.appendChild(clearButton);
        controls.appendChild(exportButton);
        controls.appendChild(closeButton);
        modal.appendChild(controls);
        
        // Add log content
        const logsContainer = document.createElement('div');
        logsContainer.style.overflowY = 'auto';
        logsContainer.style.maxHeight = 'calc(80vh - 100px)';
        logsContainer.style.fontFamily = 'monospace';
        
        // Format logs with syntax highlighting
        this.reconnectionLogs.forEach((log, index) => {
            const logEntry = document.createElement('div');
            logEntry.style.padding = '5px';
            logEntry.style.borderBottom = '1px solid #333';
            logEntry.style.fontSize = '12px';
            
            // Colorize based on type of message
            let color = '#fff';
            if (log.message.includes('error') || log.message.includes('Error')) {
                color = '#ff5555';
            } else if (log.message.includes('attempt')) {
                color = '#ffff55';
            } else if (log.message.includes('success')) {
                color = '#55ff55';
            }
            
            // Format timestamp
            const date = new Date(log.timestamp);
            const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`;
            
            // Format data if present
            let dataStr = '';
            if (log.data) {
                dataStr = `<pre style="margin-top: 5px; margin-left: 15px; color: #88aaff;">${JSON.stringify(log.data, null, 2)}</pre>`;
            }
            
            logEntry.innerHTML = `<span style="color: #999;">[${timeStr}]</span> <span style="color: ${color};">${log.message}</span>${dataStr}`;
            logsContainer.appendChild(logEntry);
        });
        
        modal.appendChild(logsContainer);
        
        // Add the modal to the document
        document.body.appendChild(modal);
    }
    
    /**
     * Initialize keyboard shortcut for showing reconnection logs
     */
    initDebugShortcuts() {
        // Listen for Ctrl+Shift+L to open logs
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.shiftKey && event.key === 'L') {
                event.preventDefault();
                this.showReconnectionLogs();
            }
            // Listen for Ctrl+Shift+R to force refresh players
            else if (event.ctrlKey && event.shiftKey && event.key === 'R') {
                event.preventDefault();
                this.forceRefresh();
            }
            // Listen for Ctrl+Shift+D to run diagnostics
            else if (event.ctrlKey && event.shiftKey && event.key === 'D') {
                event.preventDefault();
                this.runDiagnostics();
            }
            // Listen for Ctrl+Shift+M to send a test movement
            else if (event.ctrlKey && event.shiftKey && event.key === 'M') {
                event.preventDefault();
                this.sendTestMovement();
            }
        });
        
        this.logReconnection('Debug shortcuts initialized:');
        this.logReconnection('- Press Ctrl+Shift+L to show reconnection logs');
        this.logReconnection('- Press Ctrl+Shift+R to force refresh players');
        this.logReconnection('- Press Ctrl+Shift+D to run diagnostics');
        this.logReconnection('- Press Ctrl+Shift+M to send a test movement');
    }
    
    /**
     * Send a test movement to verify position updates are working
     */
    sendTestMovement() {
        this.logReconnection('Sending test movement');
        
        if (!this.socket || !this.socket.connected) {
            this.logReconnection('Cannot send test movement - socket not connected');
            return;
        }
        
        if (!this.game || !this.game.playerCharacter) {
            this.logReconnection('Cannot send test movement - player character not found');
            return;
        }
        
        // Current position
        const position = this.game.playerCharacter.mesh.position;
        const currentPos = {
            x: position.x,
            y: position.y,
            z: position.z
        };
        
        // Generate small random movement - only for testing when user is idle
        // If the player is actually moving, send current position instead
        const now = Date.now();
        const useCurrentPosition = this.lastMovementTime && (now - this.lastMovementTime < 5000);
        
        const testPos = useCurrentPosition ? 
            currentPos : 
            {
                x: position.x + (Math.random() * 0.1 - 0.05),
                y: position.y,
                z: position.z + (Math.random() * 0.1 - 0.05)
            };
        
        this.logReconnection('Test movement data', {
            from: currentPos,
            to: testPos,
            useCurrentPosition
        });
        
        // Send direct update to server
        this.socket.emit('playerUpdate', {
            id: this.socket.id,
            name: this.playerName,
            position: testPos,
            rotation: this.game.playerCharacter.mesh.rotation.y,
            timestamp: Date.now(),
            isTestMovement: true
        });
        
        // Request active players list after sending update
        setTimeout(() => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('requestActivePlayersList');
            }
        }, 500);
    }
    
    /**
     * Run diagnostics to verify multiplayer features
     */
    runDiagnostics() {
        this.logReconnection('Running multiplayer diagnostics...');
        
        // Check socket connection
        const socketStatus = this.socket ? 
            (this.socket.connected ? 'Connected' : 'Disconnected') : 
            'No socket';
        
        // Check game and scene
        const gameStatus = this.game ? 
            (this.game.scene ? 'Game and scene available' : 'Game available but no scene') : 
            'No game';
        
        // Count remote players
        const remotePlayerCount = Object.keys(this.remotePlayers).length;
        
        // Count player meshes
        let playerMeshCount = 0;
        let visibleMeshCount = 0;
        
        if (this.game && this.game.scene) {
            this.game.scene.traverse(obj => {
                if (obj.name && obj.name.startsWith('player_') && 
                    !obj.name.includes('sword') && !obj.name.includes('nameTag')) {
                    playerMeshCount++;
                    if (obj.visible) visibleMeshCount++;
                }
            });
        }
        
        // Check last position update time
        const lastUpdateTime = this._lastPositionUpdateTime ? 
            `${Math.floor((Date.now() - this._lastPositionUpdateTime) / 1000)}s ago` : 
            'Never';
        
        // Check active player IDs from server
        const activeServerPlayerIds = Array.isArray(this._activePlayerIds) ? 
            this._activePlayerIds.join(', ') : 
            'Unknown';
        
        // Compile diagnostics results
        const diagnostics = {
            socket: socketStatus,
            game: gameStatus,
            remotePlayers: remotePlayerCount,
            playerMeshes: playerMeshCount,
            visibleMeshes: visibleMeshCount,
            lastPositionUpdate: lastUpdateTime,
            activeServerPlayerIds: activeServerPlayerIds,
            sessionId: this.sessionId,
            localPlayerId: this.socket ? this.socket.id : 'Unknown'
        };
        
        this.logReconnection('Diagnostics results', diagnostics);
        
        // Display in alert for easy access
        alert(`Multiplayer Diagnostics:\n\n` +
            `Socket: ${diagnostics.socket}\n` +
            `Game: ${diagnostics.game}\n` +
            `Remote Players: ${diagnostics.remotePlayers}\n` +
            `Player Meshes: ${diagnostics.playerMeshes} (${diagnostics.visibleMeshes} visible)\n` +
            `Last Position Update: ${diagnostics.lastPositionUpdate}\n` +
            `Local Player ID: ${diagnostics.localPlayerId}`
        );
        
        // Request existing players to refresh our state
        if (this.socket && this.socket.connected) {
            this.socket.emit('requestExistingPlayers');
        }
        
        return diagnostics;
    }
    
    /**
     * Creates a debug element if one doesn't exist
     * @returns {HTMLElement} The created debug element
     */
    createDebugElement() {
        const debugDiv = document.createElement('div');
        debugDiv.id = 'debug-info';
        debugDiv.style.position = 'fixed';
        debugDiv.style.bottom = '10px';
        debugDiv.style.right = '10px';
        debugDiv.style.width = '300px';
        debugDiv.style.height = '200px';
        debugDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        debugDiv.style.color = '#fff';
        debugDiv.style.padding = '10px';
        debugDiv.style.fontSize = '12px';
        debugDiv.style.fontFamily = 'monospace';
        debugDiv.style.overflowY = 'scroll';
        debugDiv.style.zIndex = '1000';
        debugDiv.style.display = 'none'; // Hidden by default
        
        // Add a toggle button
        const toggleButton = document.createElement('button');
        toggleButton.innerText = 'Debug';
        toggleButton.style.position = 'fixed';
        toggleButton.style.bottom = '10px';
        toggleButton.style.right = '10px';
        toggleButton.style.zIndex = '1001';
        toggleButton.onclick = () => {
            if (debugDiv.style.display === 'none') {
                debugDiv.style.display = 'block';
            } else {
                debugDiv.style.display = 'none';
            }
        };
        
        document.body.appendChild(debugDiv);
        document.body.appendChild(toggleButton);
        
        return debugDiv;
    }
    
    /**
     * Sets the default config values
     */
    get defaultConfig() {
        return {
            serverUrl: window.location.origin,
            debug: false
        };
    }
    
    /**
     * Check if a player is still connected according to the server
     * Returns 'connected', 'disconnected', or 'unknown'
     */
    getPlayerServerStatus(playerId) {
        // If we have received active player IDs from the server
        if (Array.isArray(this._activePlayerIds)) {
            return this._activePlayerIds.includes(playerId) ? 'connected' : 'disconnected';
        }
        // If we haven't received that info, just return unknown
        return 'unknown';
    }
    
    /**
     * Updates positions of related meshes (sword, name tag) when player position changes
     */
    updateRelatedMeshPositions(playerId, position) {
        if (!this.game || !this.game.scene) return;
        
        // Find sword and name tag meshes
        let swordMesh = null;
        let nameTagMesh = null;
        
        this.game.scene.traverse(obj => {
            if (obj.name === `sword_${playerId}`) {
                swordMesh = obj;
            } else if (obj.name === `nameTag_${playerId}`) {
                nameTagMesh = obj;
            }
        });
        
        // Name tag should be positioned above the player
        if (nameTagMesh) {
            // If name tag is parented to player, no need to update position directly
            if (!nameTagMesh.parent || nameTagMesh.parent.name !== `player_${playerId}`) {
                nameTagMesh.position.set(position.x, position.y + 3, position.z);
            }
        }
        
        // Sword should stay with player but we don't need to update it directly
        // if it's properly parented to the player mesh
    }
    
    /**
     * Force a refresh of all players
     * This can be called when player visibility is an issue
     */
    forceRefresh() {
        this.logReconnection(`Force refresh triggered - ensuring all players are visible`);
        
        // Show the current state of remote players for debugging
        const playerCount = Object.keys(this.remotePlayers).length;
        this.logReconnection(`Current remote player count: ${playerCount}`, {
            players: Object.entries(this.remotePlayers).map(([id, player]) => ({
                id,
                name: player.name,
                lastUpdate: player._lastUpdateTime ? new Date(player._lastUpdateTime).toISOString() : 'unknown'
            }))
        });
        
        // First, check if there are any mismatches between meshes and remotePlayers
        if (this.game && this.game.scene) {
            // Track which players already have meshes
            const existingMeshes = new Map();
            const missingMeshes = [];
            
            // Find all player meshes in the scene
            this.game.scene.traverse(obj => {
                if (obj.name && obj.name.startsWith('player_')) {
                    const playerId = obj.name.split('_')[1];
                    existingMeshes.set(playerId, obj);
                    
                    // Make sure the mesh is visible
                    if (!obj.visible) {
                        this.logReconnection(`Found invisible player mesh, making visible: ${obj.name}`);
                        obj.visible = true;
                    }
                }
            });
            
            // Check if any remote players are missing meshes
            for (const playerId in this.remotePlayers) {
                if (!existingMeshes.has(playerId)) {
                    missingMeshes.push(playerId);
                }
            }
            
            this.logReconnection(`Player mesh check: ${existingMeshes.size} found, ${missingMeshes.length} missing`, {
                existing: Array.from(existingMeshes.keys()),
                missing: missingMeshes
            });
            
            // Create meshes for any missing players
            if (missingMeshes.length > 0) {
                this.logReconnection(`Creating meshes for ${missingMeshes.length} missing players`);
                missingMeshes.forEach(playerId => {
                    const playerData = this.remotePlayers[playerId];
                    if (playerData) {
                        this.logReconnection(`Creating missing mesh for player ${playerData.name} (${playerId})`);
                        this.createRemotePlayerMesh(playerId, playerData);
                        this.createNameTag(playerId, playerData);
                    }
                });
            }
        }
        
        // First approach: Request existing players from server
        this.logReconnection(`Requesting existing players from server`);
        if (this.socket && this.socket.connected) {
            this.socket.emit('requestExistingPlayers');
                        } else {
            this.logReconnection(`Cannot request players - socket not connected`);
        }
        
        // Second approach: Recreate all meshes if necessary
        setTimeout(() => {
            // Check if we need a full refresh (if players are still invisible)
            let needsFullRefresh = false;
            
            if (this.game && this.game.scene) {
                const playerMeshes = [];
                this.game.scene.traverse(obj => {
                    if (obj.name && obj.name.startsWith('player_')) {
                        playerMeshes.push(obj);
                    }
                });
                
                // If we have fewer meshes than remote players, we need a full refresh
                if (playerMeshes.length < Object.keys(this.remotePlayers).length) {
                    needsFullRefresh = true;
                }
                
                this.logReconnection(`Player meshes check: ${playerMeshes.length} vs ${Object.keys(this.remotePlayers).length} remote players`);
            } else {
                needsFullRefresh = true;
            }
            
            if (needsFullRefresh) {
                this.logReconnection(`Performing full refresh - removing and recreating all player meshes`);
            
            // Remove all existing player meshes
            if (this.game && this.game.scene) {
                const meshesToRemove = [];
                this.game.scene.traverse(obj => {
                    if (obj.name && (
                        obj.name.startsWith('player_') || 
                        obj.name.startsWith('sword_') || 
                        obj.name.startsWith('nameTag_')
                    )) {
                        meshesToRemove.push(obj);
                    }
                });
                
                this.logReconnection(`Removing ${meshesToRemove.length} existing player meshes`);
                meshesToRemove.forEach(mesh => {
                    this.logReconnection(`Disposing mesh: ${mesh.name}`);
                    if (mesh.parent) {
                        mesh.parent.remove(mesh);
                    } else {
                        this.game.scene.remove(mesh);
                    }
                    
                    // Dispose of resources
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach(mat => mat.dispose());
                        } else {
                            mesh.material.dispose();
                        }
                    }
                });
                
                // Use our dedicated method to create all meshes
                this.createMeshesForExistingPlayers();
            } else {
                this.logReconnection(`Cannot recreate meshes - game or scene not available`);
                
                // If game isn't available, re-initialize with the game
                if (window.gameInstance && window.gameInstance.scene) {
                    this.logReconnection(`Attempting to reinitialize with global game instance`);
                    this.initialize(window.gameInstance);
                }
            }
            } else {
                this.logReconnection(`Full refresh not needed, all players appear to have meshes`);
            }
        }, 1000);
    }
    
    // Add an ensureInitialized method as a safety measure
    /**
     * Ensures all required properties are properly initialized
     * Called after constructor to ensure nothing is missing
     */
    ensureInitialized() {
        // Internal tracking variables - ensure these exist
        if (!this._reconnectionLogs) this._reconnectionLogs = [];
        if (!this.reconnectionLogs) this.reconnectionLogs = [];
        if (!this._activePlayerIds) this._activePlayerIds = [];
        if (!this.remotePlayers) this.remotePlayers = {};
        
        // Check for the defaultConfig - this should be a getter but ensure it's available
        if (!this.config) {
            this.config = this.defaultConfig || {
                serverUrl: window.location.origin,
                debug: false
            };
        }
        
        // Basic state variables
        if (this.connected === undefined) this.connected = false;
        if (!this.sessionId) {
            this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }
        
        return this;
    }
    
    // Add a method to interpolate player positions in the update loop
    interpolatePlayerPositions() {
        const now = Date.now();
        
        // Process each remote player
        for (const id in this.remotePlayers) {
            const remotePlayer = this.remotePlayers[id];
            
            // Skip if no target position or mesh (nothing to interpolate)
            if (!remotePlayer.targetPosition || !remotePlayer.position) continue;
            
            // Find the player mesh
            let playerMesh = null;
            if (this.game && this.game.scene) {
                this.game.scene.traverse(obj => {
                    if (obj.name === `player_${id}`) {
                        playerMesh = obj;
                    }
                });
            }
            
            if (!playerMesh) continue;
            
            // Use adaptive interpolation time based on network quality
            const targetTime = this._interpolationTime || 100; // Default to 100ms if not set
            const timeSinceUpdate = now - (remotePlayer.lastPositionUpdateTime || 0);
            let factor = Math.min(timeSinceUpdate / targetTime, 1.0);
            
            // Apply interpolation
            if (factor < 1.0) {
                // Smooth interpolation between current and target positions
                const newX = playerMesh.position.x + (remotePlayer.targetPosition.x - playerMesh.position.x) * factor;
                const newY = playerMesh.position.y + (remotePlayer.targetPosition.y - playerMesh.position.y) * factor;
                const newZ = playerMesh.position.z + (remotePlayer.targetPosition.z - playerMesh.position.z) * factor;
                
                // Update mesh position
                playerMesh.position.set(newX, newY, newZ);
                
                // Update stored position
                remotePlayer.position.x = newX;
                remotePlayer.position.y = newY;
                remotePlayer.position.z = newZ;
                
                // Update related meshes (sword, nametag)
                this.updateRelatedMeshPositions(id, {x: newX, y: newY, z: newZ});
            } 
            else if (factor === 1.0 && 
                    (Math.abs(playerMesh.position.x - remotePlayer.targetPosition.x) > 0.01 ||
                     Math.abs(playerMesh.position.y - remotePlayer.targetPosition.y) > 0.01 ||
                     Math.abs(playerMesh.position.z - remotePlayer.targetPosition.z) > 0.01)) {
                // Final snap to exact position once factor reaches 1.0
                playerMesh.position.set(
                    remotePlayer.targetPosition.x, 
                    remotePlayer.targetPosition.y, 
                    remotePlayer.targetPosition.z
                );
                
                // Update stored position to match target
                remotePlayer.position.x = remotePlayer.targetPosition.x;
                remotePlayer.position.y = remotePlayer.targetPosition.y;
                remotePlayer.position.z = remotePlayer.targetPosition.z;
                
                // Update related meshes
                this.updateRelatedMeshPositions(id, remotePlayer.position);
            }
        }
    }
    
    // Network quality monitoring methods
    _startNetworkMonitoring() {
        // Reset network stats
        this._networkStats = {
            latencies: [],
            averageLatency: 0,
            jitter: 0,
            lastMeasurement: 0,
            packetsReceived: 0,
            measurementInterval: 5000,
            maxSamples: 50,
            qualityLevel: 'unknown'
        };
        
        // Set up periodic network quality assessment
        this._networkMonitoringInterval = setInterval(() => {
            this._assessNetworkQuality();
        }, this._networkStats.measurementInterval);
    }
    
    _trackLatency(latency) {
        // Skip invalid values
        if (typeof latency !== 'number' || isNaN(latency) || latency < 0) return;
        
        const stats = this._networkStats;
        
        // Add to latency samples, keeping only the most recent samples
        stats.latencies.push(latency);
        if (stats.latencies.length > stats.maxSamples) {
            stats.latencies.shift();
        }
        
        // Increment packet counter
        stats.packetsReceived++;
    }
    
    _assessNetworkQuality() {
        const stats = this._networkStats;
        const now = Date.now();
        
        // Calculate metrics only if we have data
        if (stats.latencies.length > 0) {
            // Calculate average latency
            const sum = stats.latencies.reduce((a, b) => a + b, 0);
            stats.averageLatency = sum / stats.latencies.length;
            
            // Calculate jitter (variation in latency)
            let jitterSum = 0;
            for (let i = 1; i < stats.latencies.length; i++) {
                jitterSum += Math.abs(stats.latencies[i] - stats.latencies[i-1]);
            }
            stats.jitter = stats.latencies.length > 1 ? jitterSum / (stats.latencies.length - 1) : 0;
            
            // Assess network quality
            if (stats.averageLatency < 50 && stats.jitter < 10) {
                stats.qualityLevel = 'excellent';
            } else if (stats.averageLatency < 100 && stats.jitter < 20) {
                stats.qualityLevel = 'good';
            } else if (stats.averageLatency < 200 && stats.jitter < 50) {
                stats.qualityLevel = 'fair';
            } else {
                stats.qualityLevel = 'poor';
            }
            
            // Log network quality (infrequently)
            if (!stats.lastQualityLog || now - stats.lastQualityLog > 30000) {
                this.log(`Network quality: ${stats.qualityLevel} (avg latency: ${stats.averageLatency.toFixed(2)}ms, jitter: ${stats.jitter.toFixed(2)}ms)`);
                stats.lastQualityLog = now;
            }
            
            // Adjust interpolation time based on network quality
            this._adjustInterpolationSettings();
        }
        
        // Reset packet counter and update last measurement time
        stats.packetsReceived = 0;
        stats.lastMeasurement = now;
    }
    
    _adjustInterpolationSettings() {
        const quality = this._networkStats.qualityLevel;
        let newInterpolationTime = 100; // default 100ms interpolation time
        
        // Adjust interpolation time based on network quality
        switch(quality) {
            case 'excellent':
                newInterpolationTime = 50; // Very responsive
                break;
            case 'good':
                newInterpolationTime = 100; // Good balance
                break;
            case 'fair':
                newInterpolationTime = 150; // More smoothing
                break;
            case 'poor':
                newInterpolationTime = 200; // Maximum smoothing
                break;
            default:
                newInterpolationTime = 100; // Default
        }
        
        // Store the interpolation time for use in the interpolation method
        this._interpolationTime = newInterpolationTime;
    }
}
