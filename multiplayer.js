/**
 * MultiplayerManager - Manages client-side multiplayer functionality
 * This class handles all interaction with the Socket.io server
 */
class MultiplayerManager {
    constructor(game) {
        // Reference to the main game object
        this.game = game;
        
        // Socket.io connection
        this.socket = null;
        
        // Remote players
        this.remotePlayers = {};
        
        // Debug elements
        this.debugElement = document.getElementById('debug');
        this.connectionStatusElement = document.getElementById('connection-status');
        this.playerCountElement = document.getElementById('player-count');
        
        // Connection status
        this.isConnected = false;
        
        // Initialize connection monitoring
        this.heartbeatInterval = null;
        this.lastServerResponse = 0;
        this.connectionTimeouts = 0;
        
        // Connection options
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        this.log('MultiplayerManager initialized');
    }
    
    /**
     * Initializes the multiplayer manager with the player character
     * @param {Character} playerCharacter - The local player's character
     */
    initialize(playerCharacter) {
        this.log('Initializing multiplayer with character');
        
        // Store reference to player character
        this.playerCharacter = playerCharacter;
        
        // Connect to the server if we haven't already
        if (!this.isConnected && this.playerName) {
            this.connect(this.playerName, playerCharacter.type, playerCharacter.swordType);
        }
    }
    
    /**
     * Initializes the connection to the Socket.io server
     * @param {string} playerName - Name of the player
     * @param {string} characterType - Type of character
     * @param {string} swordType - Type of sword
     */
    connect(playerName, characterType, swordType) {
        this.log(`Attempting to connect to Socket.io server as ${playerName}...`);
        this.updateConnectionStatus('connecting', 'Connecting to server...');
        
        // Store player info for registration
        this.playerName = playerName && playerName.trim() !== '' ? playerName.trim() : `Player_${Date.now().toString(36).substring(4)}`;
        this.characterType = characterType || 'knight';
        this.swordType = swordType || 'broadsword';
        
        console.log(`Player name set to: '${this.playerName}' (original input: '${playerName}')`);
        
        try {
            // Check if Socket.io is available
            if (typeof io === 'undefined') {
                this.log('ERROR: Socket.io client library not available');
                this.updateConnectionStatus('error', 'Socket.io not available');
                return false;
            }
            
            // Connect to the Socket.io server
            // Use a direct approach to connect to Socket.io server
            // Hardcode the URL to ensure we connect to the right place
            const serverUrl = 'http://localhost:8989';
            
            this.log(`Connecting to Socket.io server at ${serverUrl}`);
            
            // Create a direct, simple connection - just like in the socket.io example
            this.socket = io(serverUrl);
            
            // Add connection success logging
            this.socket.on('connect', () => {
                this.log(`CONNECTED TO SERVER! Socket ID: ${this.socket.id}`);
                console.log(`CONNECTED TO SERVER! Socket ID: ${this.socket.id}`);
                this.updateConnectionStatus('connected', `Connected as ${this.socket.id}`);
                
                // Immediately send a test message to the server
                this.socket.emit('test', { 
                    message: 'Client connected successfully!',
                    clientInfo: {
                        url: window.location.href,
                        userAgent: navigator.userAgent,
                        timestamp: Date.now()
                    }
                });
            });
            
            // Handle test response from server
            this.socket.on('testResponse', (data) => {
                this.log(`Received test response from server: ${data.message}`);
                console.log('Server test response:', data);
                
                // Update status with server info
                this.updateConnectionStatus('verified', 
                    `Connected to server with ${data.clientsConnected} client(s) and ${data.playersRegistered} player(s)`);
                
                // Now that we've confirmed the connection works, register the player
                if (this.playerCharacter || this.game.playerCharacter) {
                    this.registerPlayer();
                } else {
                    this.log('No player character yet - will register when character is created');
                }
            });
            
            // Log connection errors in detail for debugging
            this.socket.on('connect_error', (err) => {
                this.log(`Connection error: ${err.message}`);
                console.error('Socket.io connect_error:', err);
                this.updateConnectionStatus('error', `Connection error: ${err.message}`);
            });
            
            this.socket.on('connect_timeout', () => {
                this.log('Connection timeout');
                this.updateConnectionStatus('error', 'Connection timeout');
            });
            
            // Setup event handlers
            this.setupSocketEvents();
            
            return true;
        } catch (error) {
            this.log(`ERROR connecting: ${error.message}`);
            this.updateConnectionStatus('error', 'Connection error');
            return false;
        }
    }
    
    /**
     * Sets up Socket.io event handlers
     */
    setupSocketEvents() {
        // Connection established
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.log(`Connected to server. Socket ID: ${this.socket.id}`);
            this.updateConnectionStatus('connected', 'Connected');
            
            // Reset reconnection attempts on successful connection
            this.reconnectAttempts = 0;
            
            // Start heartbeat monitoring
            this.startHeartbeat();
            
            // Register player with server
            this.log(`Registering player with server after connection...`);
            this.registerPlayer();
            
            // Request existing players list after short delay
            setTimeout(() => {
                this.log(`Requesting existing players list...`);
                this.socket.emit('requestExistingPlayers');
            }, 1000);
        });
        
        // Connection error
        this.socket.on('connect_error', (error) => {
            this.log(`Connection error: ${error.message}`);
            this.updateConnectionStatus('error', 'Connection error');
        });
        
        // Disconnection
        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            this.log(`Disconnected from server. Reason: ${reason}`);
            this.updateConnectionStatus('disconnected', 'Disconnected');
            
            // Clear heartbeat
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
            
            // Handle reconnection
            if (reason === 'io server disconnect') {
                // Server initiated disconnect, try to reconnect manually
                this.reconnect();
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
            this.isConnected = true;
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
        
        // Receive existing players
        this.socket.on('existingPlayers', (players) => {
            this.log(`Received ${Object.keys(players).length} existing players`);
            
            if (Object.keys(players).length === 0) {
                this.log(`No existing players received from server`);
                return;
            }
            
            // Process existing players
            for (const id in players) {
                // Skip if this is us
                if (id === this.socket.id) {
                    this.log(`Skipping adding ourselves as a remote player`);
                    continue;
                }
                
                // Log player details
                const player = players[id];
                this.log(`Processing existing player: ${player.name} (${id}) with ${player.characterType}`);
                
                if (!this.remotePlayers[id]) {
                    this.log(`Adding remote player: ${player.name} (${id}) with ${player.characterType}`);
                    this.addRemotePlayer(players[id]);
                } else {
                    this.log(`Player ${player.name} (${id}) already exists in our remotePlayers list, updating`);
                    this.updateRemotePlayer(players[id]);
                }
            }
            
            // Update player count display
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
            const playerId = typeof data === 'string' ? data : data.id;
            const playerName = typeof data === 'object' && data.name ? data.name : playerId;
            
            this.log(`Player left: ${playerName} (${playerId})`);
            
            if (!this.remotePlayers[playerId]) {
                this.log(`Player ${playerId} not found in remotePlayers list, cannot remove`);
                return;
            }
            
            // Remove remote player
            this.removeRemotePlayer(playerId);
            
            // Update player count display
            this.updatePlayerCount();
        });
        
        // Player updated
        this.socket.on('playerUpdated', (playerData) => {
            // Update remote player
            this.updateRemotePlayer(playerData);
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
     */
    reconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.log(`Manual reconnection attempt ${this.reconnectAttempts}...`);
            this.updateConnectionStatus('connecting', `Reconnecting (attempt ${this.reconnectAttempts})...`);
            
            // Try to reconnect
            this.socket.connect();
        } else {
            this.log('Max reconnection attempts reached. Giving up.');
            this.updateConnectionStatus('error', 'Failed to reconnect');
        }
    }
    
    /**
     * Registers the player with the server
     */
    registerPlayer() {
        if (!this.socket) {
            this.log('Cannot register player: no socket connection exists');
            return;
        }
        
        if (!this.socket.connected) {
            this.log('Cannot register player: socket exists but is not connected');
            this.log('Will attempt to reconnect first...');
            this.socket.connect();
            return;
        }
        
        this.log('Preparing to register player with server...');
        
        // If the character exists, use its position; otherwise use default position
        let position = { x: 0, y: 0, z: 0 };
        let characterType = this.characterType || 'knight';
        let swordType = this.swordType || 'broadsword';
        
        // First check this.playerCharacter and fallback to this.game.playerCharacter
        const character = this.playerCharacter || this.game.playerCharacter;
        
        if (character && character.mesh) {
            position = {
                x: character.mesh.position.x,
                y: character.mesh.position.y,
                z: character.mesh.position.z
            };
            characterType = character.type;
            swordType = character.swordType;
            
            this.log(`Using character position: ${JSON.stringify(position)}`);
        } else {
            this.log('No character mesh available, using default position');
        }
        
        const playerData = {
            name: this.playerName, // Use the name set during connect
            characterType: characterType,
            swordType: swordType,
            position: position,
            timestamp: Date.now() // Add timestamp for debugging
        };
        
        // Double-check that we have a valid name
        if (!playerData.name || playerData.name.trim() === '') {
            console.error('WARNING: Player name is empty or invalid, using fallback name');
            playerData.name = `Player_${this.socket.id.substring(0, 5)}`;
        }
        
        this.log(`Registering player with server: ${playerData.name} (${this.socket.id})`);
        console.log(`REGISTERING PLAYER WITH SERVER: ${JSON.stringify(playerData)}`);
        
        // Emit the playerJoin event to register with the server
        this.socket.emit('playerJoin', playerData);
        
        // Request existing players after registration
        setTimeout(() => {
            this.log('Requesting existing players list after registration');
            this.socket.emit('requestExistingPlayers');
        }, 500);
    }
    
    /**
     * Sends a respawn event to the server
     */
    respawnPlayer(position) {
        if (!this.isConnected) return;
        
        this.log(`Sending respawn event to server at position (${position.x}, ${position.y}, ${position.z})`);
        this.socket.emit('playerRespawn', { position });
    }
    
    /**
     * Sends an attack event to the server
     */
    sendAttack(attackData) {
        if (!this.isConnected) return;
        
        // Log the attack data for debugging
        console.log('[MultiplayerManager] Sending attack to server:', attackData);
        
        // Ensure attackData exists and has required properties
        if (!attackData) {
            console.error('[MultiplayerManager] Attack data is null or undefined, creating default data');
            attackData = {
                position: { x: 0, y: 0, z: 0 },
                direction: { x: 0, y: 0, z: 0 },
                swordType: this.playerCharacter ? this.playerCharacter.swordType : 'broadsword',
                damage: 10,
                hitPlayers: []
            };
        }
        
        // Verify the data structure to prevent server errors
        const sanitizedData = {
            position: attackData.position || { x: 0, y: 0, z: 0 },
            direction: attackData.direction || { x: 0, y: 0, z: 0 },
            swordType: attackData.swordType || (this.playerCharacter ? this.playerCharacter.swordType : 'broadsword'),
            damage: attackData.damage || 10,
            hitPlayers: Array.isArray(attackData.hitPlayers) ? attackData.hitPlayers : []
        };
        
        // Send the attack event to the server
        this.socket.emit('playerAttack', sanitizedData);
    }
    
    /**
     * Updates the player's position on the server
     */
    updatePosition() {
        if (!this.isConnected || !this.game.playerCharacter) return;
        
        const character = this.game.playerCharacter;
        const position = character.mesh.position;
        const rotation = character.mesh.rotation.y;
        
        // Only send update if position has changed
        if (this.lastPosition &&
            this.lastPosition.x === position.x &&
            this.lastPosition.y === position.y &&
            this.lastPosition.z === position.z &&
            this.lastRotation === rotation) {
            return;
        }
        
        // Send update to server
        this.socket.emit('playerUpdate', {
            name: this.playerName || character.name, // Include player name
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            },
            rotation: rotation,
            health: character.health,
            action: character.currentAction,
            swordType: character.swordType, // Include sword type for syncing
        });
        
        // Update last position and rotation
        this.lastPosition = { x: position.x, y: position.y, z: position.z };
        this.lastRotation = rotation;
    }
    
    /**
     * Adds a remote player to the scene
     */
    addRemotePlayer(playerData) {
        this.log(`Adding remote player: ${playerData.name} (${playerData.id}) with ${playerData.characterType}`);
        
        // Check if we already have this player
        if (this.remotePlayers[playerData.id]) {
            this.log(`WARNING: Player ${playerData.id} already exists in remotePlayers! Removing old instance first.`);
            this.removeRemotePlayer(playerData.id);
        }
        
        // Skip adding if this is us (which shouldn't happen but just in case)
        if (playerData.id === this.socket.id) {
            this.log(`ERROR: Attempted to add ourselves as a remote player! Skipping.`);
            return;
        }
        
        try {
            // Create remote character
            const remotePlayer = this.game.createRemoteCharacter(playerData);
            
            if (!remotePlayer) {
                this.log(`ERROR: Failed to create remote character for ${playerData.name} (${playerData.id})`);
                return;
            }
            
            // Store reference
            this.remotePlayers[playerData.id] = remotePlayer;
            
            this.log(`Successfully added remote player: ${playerData.name} (${playerData.id})`);
            
            // Update player count
            this.updatePlayerCount();
        } catch (error) {
            this.log(`ERROR: Failed to add remote player ${playerData.id}: ${error.message}`);
        }
    }
    
    /**
     * Removes a remote player from the scene
     */
    removeRemotePlayer(playerId) {
        if (!this.remotePlayers[playerId]) {
            this.log(`Cannot remove remote player ${playerId}: not found in remotePlayers list`);
            return;
        }
        
        this.log(`Removing remote player: ${playerId}`);
        
        try {
            // Remove from scene
            const player = this.remotePlayers[playerId];
            
            // Get player name for better logging
            const playerName = player.name || playerId;
            
            this.log(`Removing ${playerName} (${playerId}) from scene`);
            this.game.scene.remove(player);
            
            // Remove any associated objects
            if (player.nameTag) {
                this.log(`Removing name tag for ${playerName}`);
                this.game.scene.remove(player.nameTag);
            }
            
            if (player.healthBarContainer) {
                this.log(`Removing health bar for ${playerName}`);
                this.game.scene.remove(player.healthBarContainer);
            }
            
            // Remove from list
            delete this.remotePlayers[playerId];
            this.log(`Successfully removed ${playerName} (${playerId}) from remotePlayers list`);
            
            // Update player count
            this.updatePlayerCount();
        } catch (error) {
            this.log(`ERROR: Failed to remove remote player ${playerId}: ${error.message}`);
        }
    }
    
    /**
     * Updates a remote player's position and state
     */
    updateRemotePlayer(playerData) {
        try {
            const remotePlayer = this.remotePlayers[playerData.id];
            if (!remotePlayer) {
                this.log(`Warning: Attempted to update non-existent remote player: ${playerData.id}`);
                return;
            }
            
            // Log update event for debugging
            this.log(`Updating remote player ${playerData.id} (${remotePlayer.name || 'unnamed'})`);
            
            // Update sword type if it has changed
            if (playerData.swordType && remotePlayer.swordType !== playerData.swordType) {
                this.log(`Remote player ${playerData.id} switched sword to ${playerData.swordType}`);
                
                // Check if the remote player has the switchSword method
                if (typeof remotePlayer.switchSword === 'function') {
                    try {
                        remotePlayer.switchSword(playerData.swordType);
                    } catch (error) {
                        console.error(`Error switching sword for remote player: ${error.message}`);
                        // Fall back to createSword if that exists
                        if (typeof remotePlayer.createSword === 'function') {
                            // Remove existing sword if present
                            if (remotePlayer.sword && remotePlayer.mesh) {
                                remotePlayer.mesh.remove(remotePlayer.sword);
                            }
                            remotePlayer.createSword(playerData.swordType);
                        }
                    }
                }
                
                // Update the stored sword type
                remotePlayer.swordType = playerData.swordType;
            }
            
            // Update position
            if (playerData.position) {
                // Check if remotePlayer.position is a Vector3, otherwise create it
                if (!remotePlayer.position || typeof remotePlayer.position.set !== 'function') {
                    this.log(`Creating new Vector3 for player ${playerData.id} as position was not a Vector3`);
                    remotePlayer.position = new THREE.Vector3(
                        playerData.position.x || 0,
                        playerData.position.y || 0,
                        playerData.position.z || 0
                    );
                } else {
                    // Update character's position reference if it's a Vector3
                    remotePlayer.position.set(
                        playerData.position.x || 0,
                        playerData.position.y || 0,
                        playerData.position.z || 0
                    );
                }
                
                // Also update mesh position directly to ensure it moves
                if (remotePlayer.mesh) {
                    remotePlayer.mesh.position.set(
                        playerData.position.x || 0,
                        playerData.position.y || 0,
                        playerData.position.z || 0
                    );
                }
                
                this.log(`Remote player ${playerData.id} position updated to (${playerData.position.x.toFixed(2)}, ${playerData.position.y.toFixed(2)}, ${playerData.position.z.toFixed(2)})`);
            }
            
            // Update rotation
            if (typeof playerData.rotation === 'number') {
                // Update character rotation reference
                remotePlayer.rotation = playerData.rotation;
                
                // Also update mesh rotation directly to ensure it rotates
                if (remotePlayer.mesh) {
                    remotePlayer.mesh.rotation.y = playerData.rotation;
                }
                
                this.log(`Remote player ${playerData.id} rotation updated to ${playerData.rotation.toFixed(2)}`);
            }
            
            // Update health
            if (typeof playerData.health === 'number') {
                remotePlayer.health = playerData.health;
                
                // Update health bar if they have one
                if (remotePlayer.healthBar) {
                    const healthPercent = Math.max(0, playerData.health) / 100;
                    remotePlayer.healthBar.scale.x = healthPercent;
                }
                
                // If they've been defeated, hide them
                if (playerData.health <= 0) {
                    remotePlayer.visible = false;
                }
            }
            
            // Update action
            if (playerData.action) {
                // Handle any animations based on action
                if (playerData.action === 'attacking') {
                    // Play attack animation
                    if (remotePlayer.attackAnimation) {
                        remotePlayer.attackAnimation.play();
                    }
                }
            }
            
            // Update nametag position
            if (remotePlayer.nameTag) {
                try {
                    // Ensure position is valid and handle both Vector3 and plain objects
                    if (remotePlayer.position) {
                        if (typeof remotePlayer.position.copy === 'function') {
                            remotePlayer.nameTag.position.copy(remotePlayer.position);
                        } else if (typeof remotePlayer.position.x === 'number') {
                            remotePlayer.nameTag.position.set(
                                remotePlayer.position.x || 0,
                                remotePlayer.position.y || 0,
                                remotePlayer.position.z || 0
                            );
                        }
                        remotePlayer.nameTag.position.y += 2.5; // Position above head
                    }
                    
                    // Make name tag face the camera
                    if (this.game.camera) {
                        remotePlayer.nameTag.lookAt(this.game.camera.position);
                    }
                } catch (e) {
                    this.log(`Error updating name tag position: ${e.message}`);
                }
            }
            
            // Update health bar position
            if (remotePlayer.healthBarContainer) {
                try {
                    // Ensure position is valid and handle both Vector3 and plain objects
                    if (remotePlayer.position) {
                        if (typeof remotePlayer.position.copy === 'function') {
                            remotePlayer.healthBarContainer.position.copy(remotePlayer.position);
                        } else if (typeof remotePlayer.position.x === 'number') {
                            remotePlayer.healthBarContainer.position.set(
                                remotePlayer.position.x || 0,
                                remotePlayer.position.y || 0,
                                remotePlayer.position.z || 0
                            );
                        } else {
                            this.log(`Cannot update health bar: invalid position format`);
                        }
                        remotePlayer.healthBarContainer.position.y += 2.2; // Position above head
                    }
                    
                    // Make health bar face the camera
                    if (this.game.camera) {
                        remotePlayer.healthBarContainer.lookAt(this.game.camera.position);
                    }
                } catch (e) {
                    this.log(`Error updating health bar position: ${e.message}`);
                }
            }
        } catch (error) {
            console.error(`Error updating remote player: ${error.message}`);
        }
    }
    
    /**
     * Handles a remote player's attack
     */
    handleRemotePlayerAttack(data) {
        try {
            // Validate input data
            if (!data || !data.id) {
                this.log('Received invalid attack data');
                return;
            }
            
            const remotePlayer = this.remotePlayers[data.id];
            if (!remotePlayer) {
                this.log(`Unknown remote player ${data.id} attacked - ignoring`);
                return;
            }
            
            this.log(`Remote player ${data.id} attacked with ${data.swordType || 'unknown weapon'}`);
            
            // Update the remote player's sword type if it's included in the attack data
            if (data.swordType && remotePlayer.swordType !== data.swordType) {
                // Store the sword type for future reference
                remotePlayer.swordType = data.swordType;
                
                // Try to update the visual sword if the player has the switchSword method
                if (typeof remotePlayer.switchSword === 'function') {
                    try {
                        remotePlayer.switchSword(data.swordType);
                    } catch (error) {
                        console.error(`Error switching sword during attack: ${error.message}`);
                    }
                }
            }
            
            // Play attack animation
            if (remotePlayer.attackAnimation) {
                remotePlayer.attackAnimation.play();
            }
            
            // Check if our character was hit
            // Make sure hitPlayers is an array before using includes
            const hitPlayers = Array.isArray(data.hitPlayers) ? data.hitPlayers : [];
            if (this.game.playerCharacter && this.socket && hitPlayers.includes(this.socket.id)) {
                this.log(`We were hit by player ${data.id}`);
                
                // Calculate damage based on remote player's sword type
                let damage = 10; // Default damage
                const swordType = data.swordType || remotePlayer.swordType || 'broadsword';
                
                switch(swordType) {
                    case 'broadsword': damage = 15; break;
                    case 'katana': damage = 12; break;
                    case 'ninjato': damage = 10; break;
                    case 'greatsword': damage = 20; break;
                    case 'rapier': damage = 12; break;
                    case 'dualdaggers': damage = 8; break;
                }
                
                // Apply damage
                if (typeof this.game.playerCharacter.takeDamage === 'function') {
                    this.game.playerCharacter.takeDamage(damage, data.id);
                }
                
                // Check if we've been defeated
                if (this.game.playerCharacter.health <= 0) {
                    if (typeof this.game.playerCharacter.showRespawnUI === 'function') {
                        this.game.playerCharacter.showRespawnUI();
                    }
                }
            }
        } catch (error) {
            console.error(`Error handling remote player attack: ${error.message}`);
        }
    }
    
    /**
     * Updates the player count display
     */
    updatePlayerCount() {
        const totalPlayers = Object.keys(this.remotePlayers).length + 1; // +1 for local player
        
        if (this.playerCountElement) {
            this.playerCountElement.textContent = `Players: ${totalPlayers}`;
        }
    }
    
    /**
     * Updates the connection status display
     */
    updateConnectionStatus(status, message) {
        if (!this.connectionStatusElement) return;
        
        // Clear existing classes
        this.connectionStatusElement.className = '';
        
        // Add appropriate class
        this.connectionStatusElement.classList.add(`status-${status}`);
        
        // Update text
        this.connectionStatusElement.textContent = message;
    }
    
    /**
     * Logs a message to the debug console
     */
    log(message) {
        console.log(`[Multiplayer] ${message}`);
        
        if (this.debugElement) {
            const timestamp = new Date().toLocaleTimeString();
            this.debugElement.innerHTML += `<div>[${timestamp}] ${message}</div>`;
            
            // Auto-scroll to bottom
            this.debugElement.scrollTop = this.debugElement.scrollHeight;
        }
    }
    
    /**
     * Updates the multiplayer system
     */
    update() {
        // Send position update
        this.updatePosition();
        
        // Update remote players
        for (const id in this.remotePlayers) {
            const remotePlayer = this.remotePlayers[id];
            
            // Update nametag position
            if (remotePlayer.nameTag) {
                try {
                    // Ensure position is valid and handle both Vector3 and plain objects
                    if (remotePlayer.position) {
                        if (typeof remotePlayer.position.copy === 'function') {
                            remotePlayer.nameTag.position.copy(remotePlayer.position);
                        } else if (typeof remotePlayer.position.x === 'number') {
                            remotePlayer.nameTag.position.set(
                                remotePlayer.position.x || 0,
                                remotePlayer.position.y || 0,
                                remotePlayer.position.z || 0
                            );
                        } else {
                            this.log(`Cannot update name tag: invalid position format`);
                        }
                        remotePlayer.nameTag.position.y += 2.5; // Position above head
                    }
                    
                    // Make name tag face the camera
                    if (this.game.camera) {
                        remotePlayer.nameTag.lookAt(this.game.camera.position);
                    }
                } catch (e) {
                    this.log(`Error updating name tag position: ${e.message}`);
                }
            }
            
            // Update health bar position
            if (remotePlayer.healthBarContainer) {
                try {
                    // Ensure position is valid and handle both Vector3 and plain objects
                    if (remotePlayer.position) {
                        if (typeof remotePlayer.position.copy === 'function') {
                            remotePlayer.healthBarContainer.position.copy(remotePlayer.position);
                        } else if (typeof remotePlayer.position.x === 'number') {
                            remotePlayer.healthBarContainer.position.set(
                                remotePlayer.position.x || 0,
                                remotePlayer.position.y || 0,
                                remotePlayer.position.z || 0
                            );
                        } else {
                            this.log(`Cannot update health bar: invalid position format`);
                        }
                        remotePlayer.healthBarContainer.position.y += 2.2; // Position above head
                    }
                    
                    // Make health bar face the camera
                    if (this.game.camera) {
                        remotePlayer.healthBarContainer.lookAt(this.game.camera.position);
                    }
                } catch (e) {
                    this.log(`Error updating health bar position: ${e.message}`);
                }
            }
        }
    }
}
