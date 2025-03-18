// Multiplayer.js - Client-side multiplayer integration

class MultiplayerManager {
    constructor(game) {
        this.game = game;
        this.socket = null;
        this.players = {}; // Other connected players
        this.connected = false;
        this.playerName = '';
        this.lastUpdateSent = 0;
        this.updateInterval = 50; // Send updates every 50ms
    }

    // Initialize connection to the server
    connect(playerName, characterType, swordType) {
        if (this.connected) return;
        
        this.playerName = playerName;
        
        // Connect to the Socket.io server
        this.socket = io();
        
        // Connection established
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.connected = true;
            
            // Join game with player data
            this.socket.emit('playerJoin', {
                name: playerName,
                characterType: characterType,
                swordType: swordType
            });
            
            // Start sending regular updates
            this.startSendingUpdates();
        });
        
        // Set up event listeners for multiplayer events
        this.setupEventListeners();
    }
    
    // Set up Socket.io event listeners
    setupEventListeners() {
        // New player joined
        this.socket.on('playerJoined', (playerData) => {
            console.log(`Player joined: ${playerData.name}`);
            
            // Create remote player character
            this.addRemotePlayer(playerData);
        });
        
        // Player updated (moved, rotated, etc.)
        this.socket.on('playerUpdated', (playerData) => {
            this.updateRemotePlayer(playerData);
        });
        
        // Player attacked
        this.socket.on('playerAttacked', (attackData) => {
            this.handleRemotePlayerAttack(attackData);
        });
        
        // Health update (after taking damage)
        this.socket.on('healthUpdate', (healthData) => {
            this.updatePlayerHealth(healthData);
        });
        
        // Player defeated
        this.socket.on('playerDefeated', (defeatData) => {
            this.handlePlayerDefeat(defeatData);
        });
        
        // Player respawned
        this.socket.on('playerRespawned', (respawnData) => {
            this.handleRemotePlayerRespawn(respawnData);
        });
        
        // Player left the game
        this.socket.on('playerLeft', (leftData) => {
            this.removeRemotePlayer(leftData.id);
        });
        
        // Disconnected from server
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.connected = false;
            
            // Clear all remote players
            this.clearAllRemotePlayers();
        });
    }
    
    // Start sending regular player updates to the server
    startSendingUpdates() {
        setInterval(() => {
            if (!this.connected || !this.game.playerCharacter) return;
            
            // Only send updates at fixed intervals and if player has moved
            const now = Date.now();
            if (now - this.lastUpdateSent < this.updateInterval) return;
            
            this.lastUpdateSent = now;
            
            // Send player position, rotation, and state
            this.socket.emit('playerUpdate', {
                position: {
                    x: this.game.playerCharacter.position.x,
                    y: this.game.playerCharacter.position.y,
                    z: this.game.playerCharacter.position.z
                },
                rotation: this.game.playerCharacter.rotation,
                isAttacking: this.game.playerCharacter.isAttacking,
                isBlocking: this.game.playerCharacter.isBlocking,
                swordType: this.game.playerCharacter.swordType
            });
        }, this.updateInterval);
    }
    
    // Send attack information to server
    sendAttack(attackData) {
        if (!this.connected) return;
        
        this.socket.emit('playerAttack', {
            position: {
                x: this.game.playerCharacter.position.x,
                y: this.game.playerCharacter.position.y,
                z: this.game.playerCharacter.position.z
            },
            direction: this.game.playerCharacter.rotation,
            swordType: this.game.playerCharacter.swordType,
            damage: this.game.playerCharacter.attackPower + 
                    (this.game.playerCharacter.swordStats ? 
                     this.game.playerCharacter.swordStats.damage : 0)
        });
    }
    
    // Report damage to server
    sendDamage(targetId, damage) {
        if (!this.connected) return;
        
        this.socket.emit('playerDamaged', {
            targetId: targetId,
            damage: damage
        });
    }
    
    // Create a new character for a remote player
    addRemotePlayer(playerData) {
        // Check if player already exists
        if (this.players[playerData.id]) return;
        
        // Create new character for remote player
        const remotePlayer = new Character(this.game, playerData.characterType);
        remotePlayer.isRemotePlayer = true;
        remotePlayer.remoteId = playerData.id;
        remotePlayer.remoteName = playerData.name;
        
        // Position the remote player
        remotePlayer.position.x = playerData.position.x;
        remotePlayer.position.y = playerData.position.y;
        remotePlayer.position.z = playerData.position.z;
        remotePlayer.rotation = playerData.rotation;
        
        // Create sword for remote player
        remotePlayer.createSword(playerData.swordType);
        
        // Add remote player to the scene
        if (remotePlayer.mesh) {
            this.game.scene.add(remotePlayer.mesh);
        }
        
        // Add name label above player
        this.addPlayerNameLabel(remotePlayer);
        
        // Store remote player
        this.players[playerData.id] = remotePlayer;
    }
    
    // Add a name label above the player
    addPlayerNameLabel(player) {
        // Create canvas for name label
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        
        // Draw background
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        context.font = '24px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.fillText(player.remoteName, canvas.width / 2, 40);
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        
        // Create sprite material
        const material = new THREE.SpriteMaterial({ map: texture });
        
        // Create sprite
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2, 0.5, 1);
        sprite.position.y = 3; // Position above player
        
        // Add sprite to player mesh
        if (player.mesh) {
            player.mesh.add(sprite);
            player.nameSprite = sprite;
        }
    }
    
    // Update remote player position and state
    updateRemotePlayer(playerData) {
        const player = this.players[playerData.id];
        if (!player) return;
        
        // Update position and rotation
        if (playerData.position) {
            // Use lerp for smooth movement
            player.position.x = THREE.MathUtils.lerp(player.position.x, playerData.position.x, 0.3);
            player.position.y = THREE.MathUtils.lerp(player.position.y, playerData.position.y, 0.3);
            player.position.z = THREE.MathUtils.lerp(player.position.z, playerData.position.z, 0.3);
            
            // Update mesh position
            if (player.mesh) {
                player.mesh.position.set(player.position.x, player.position.y, player.position.z);
            }
        }
        
        // Update rotation
        if (playerData.rotation !== undefined) {
            player.rotation = playerData.rotation;
            
            // Update mesh rotation
            if (player.mesh) {
                player.mesh.rotation.y = player.rotation;
            }
        }
        
        // Update attack state
        if (playerData.isAttacking !== undefined) {
            if (playerData.isAttacking && !player.isAttacking) {
                // Start attack animation for remote player
                player.attack();
            }
            player.isAttacking = playerData.isAttacking;
        }
        
        // Update blocking state
        if (playerData.isBlocking !== undefined) {
            if (playerData.isBlocking && !player.isBlocking) {
                player.startBlocking();
            } else if (!playerData.isBlocking && player.isBlocking) {
                player.stopBlocking();
            }
            player.isBlocking = playerData.isBlocking;
        }
        
        // Update sword type if changed
        if (playerData.swordType && playerData.swordType !== player.swordType) {
            player.createSword(playerData.swordType);
        }
    }
    
    // Handle a remote player's attack
    handleRemotePlayerAttack(attackData) {
        const attacker = this.players[attackData.id];
        if (!attacker) return;
        
        // Trigger attack animation
        attacker.attack();
        
        // Check if local player is hit
        this.checkAttackHit(attacker, attackData);
    }
    
    // Check if an attack hits the local player
    checkAttackHit(attacker, attackData) {
        if (!this.game.playerCharacter) return;
        
        // Calculate distance between attacker and local player
        const dist = this.calculateDistance(
            attackData.position, 
            {
                x: this.game.playerCharacter.position.x, 
                y: this.game.playerCharacter.position.y, 
                z: this.game.playerCharacter.position.z
            }
        );
        
        // Get range based on sword type
        let range = 2; // Default range
        if (attacker.swordStats && attacker.swordStats.range) {
            range = attacker.swordStats.range / 5; // Normalize range
        }
        
        // Check if player is in range
        if (dist <= range) {
            // Check if player is in attack arc (in front of attacker)
            const angleToPlayer = Math.atan2(
                this.game.playerCharacter.position.x - attackData.position.x,
                this.game.playerCharacter.position.z - attackData.position.z
            );
            
            const attackAngle = attackData.direction;
            const angleDiff = Math.abs(angleToPlayer - attackAngle);
            
            // If player is within 60 degrees of attack direction
            if (angleDiff < Math.PI / 3 || angleDiff > Math.PI * 5 / 3) {
                // Apply damage to local player if not blocking
                if (!this.game.playerCharacter.isBlocking) {
                    this.game.playerCharacter.takeDamage(attackData.damage);
                } else {
                    // Reduced damage if blocking
                    this.game.playerCharacter.takeDamage(attackData.damage * 0.2);
                }
            }
        }
    }
    
    // Update player health after taking damage
    updatePlayerHealth(healthData) {
        if (healthData.id === this.socket.id) {
            // Update local player health
            if (this.game.playerCharacter) {
                this.game.playerCharacter.health = healthData.health;
                this.updateHealthUI();
            }
        } else {
            // Update remote player health
            const player = this.players[healthData.id];
            if (player) {
                player.health = healthData.health;
            }
        }
    }
    
    // Update health UI
    updateHealthUI() {
        const healthBar = document.getElementById('health-bar');
        if (healthBar && this.game.playerCharacter) {
            healthBar.style.width = `${(this.game.playerCharacter.health / 100) * 100}%`;
        }
    }
    
    // Handle player defeat
    handlePlayerDefeat(defeatData) {
        if (defeatData.id === this.socket.id) {
            // Local player defeated
            this.showDefeatScreen();
        } else {
            // Remote player defeated
            const player = this.players[defeatData.id];
            if (player && player.mesh) {
                // Show defeat animation for remote player
                this.showRemotePlayerDefeat(player);
            }
        }
    }
    
    // Show defeat screen for local player
    showDefeatScreen() {
        // Create defeat overlay
        const defeatOverlay = document.createElement('div');
        defeatOverlay.id = 'defeat-overlay';
        defeatOverlay.style.position = 'absolute';
        defeatOverlay.style.top = '0';
        defeatOverlay.style.left = '0';
        defeatOverlay.style.width = '100%';
        defeatOverlay.style.height = '100%';
        defeatOverlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
        defeatOverlay.style.display = 'flex';
        defeatOverlay.style.flexDirection = 'column';
        defeatOverlay.style.justifyContent = 'center';
        defeatOverlay.style.alignItems = 'center';
        defeatOverlay.style.color = 'white';
        defeatOverlay.style.fontSize = '48px';
        defeatOverlay.style.fontWeight = 'bold';
        defeatOverlay.style.zIndex = '1000';
        
        // Add message
        defeatOverlay.innerHTML = `
            <div>DEFEATED</div>
            <div style="font-size: 24px; margin-top: 20px;">Press R to respawn</div>
        `;
        
        document.body.appendChild(defeatOverlay);
        
        // Add respawn handler
        const respawnHandler = (e) => {
            if (e.key.toLowerCase() === 'r') {
                // Remove overlay
                document.body.removeChild(defeatOverlay);
                document.removeEventListener('keydown', respawnHandler);
                
                // Respawn player
                this.respawnPlayer();
            }
        };
        
        document.addEventListener('keydown', respawnHandler);
    }
    
    // Show defeat animation for remote player
    showRemotePlayerDefeat(player) {
        if (!player.mesh) return;
        
        // Fade out player mesh
        const fadeOut = setInterval(() => {
            if (player.mesh.material instanceof Array) {
                player.mesh.material.forEach(mat => {
                    if (mat.opacity > 0) {
                        mat.opacity -= 0.05;
                    }
                });
            } else if (player.mesh.material) {
                if (player.mesh.material.opacity > 0) {
                    player.mesh.material.opacity -= 0.05;
                }
            }
            
            // When fully transparent, remove from scene
            if (player.mesh.material.opacity <= 0) {
                clearInterval(fadeOut);
                setTimeout(() => {
                    this.respawnRemotePlayer(player);
                }, 3000);
            }
        }, 100);
    }
    
    // Respawn local player
    sendRespawn(position) {
        if (!this.socket || !this.connected) return;
        
        // Send respawn event to server
        this.socket.emit('playerRespawn', {
            position: position
        });
        
        console.log('Sent respawn event to server:', position);
    }
    
    respawnPlayer() {
        if (!this.game.playerCharacter) return;
        
        // Reset health
        this.game.playerCharacter.health = 100;
        this.updateHealthUI();
        
        // Randomize position
        this.game.playerCharacter.position.x = (Math.random() - 0.5) * 40;
        this.game.playerCharacter.position.z = (Math.random() - 0.5) * 40;
        
        // Update position on server
        this.lastUpdateSent = 0; // Force immediate update
        
        // Notify server about respawn
        this.sendRespawn(this.game.playerCharacter.position);
    }
    
    // Handle a remote player respawning
    handleRemotePlayerRespawn(respawnData) {
        const { id, position } = respawnData;
        
        // Get the player from our players list
        const player = this.players[id];
        if (!player) return;
        
        // Update player position
        player.position = position;
        
        // Update the player's mesh position
        if (player.mesh) {
            player.mesh.position.set(position.x, position.y, position.z);
        }
        
        // Reset player health
        player.health = 100;
        
        // Visual effect for respawn
        this.respawnRemotePlayer(player);
        
        console.log(`Remote player ${id} respawned at:`, position);
    }
    
    // Respawn remote player
    respawnRemotePlayer(player) {
        if (!player.mesh) return;
        
        // Reset opacity
        if (player.mesh.material instanceof Array) {
            player.mesh.material.forEach(mat => {
                mat.opacity = 1;
            });
        } else if (player.mesh.material) {
            player.mesh.material.opacity = 1;
        }
        
        // Randomize position
        player.position.x = (Math.random() - 0.5) * 40;
        player.position.z = (Math.random() - 0.5) * 40;
        
        if (player.mesh) {
            player.mesh.position.set(player.position.x, player.position.y, player.position.z);
        }
    }
    
    // Remove a remote player
    removeRemotePlayer(playerId) {
        const player = this.players[playerId];
        if (!player) return;
        
        // Remove from scene
        if (player.mesh) {
            this.game.scene.remove(player.mesh);
        }
        
        // Remove from players object
        delete this.players[playerId];
    }
    
    // Clear all remote players
    clearAllRemotePlayers() {
        Object.keys(this.players).forEach(playerId => {
            this.removeRemotePlayer(playerId);
        });
        this.players = {};
    }
    
    // Calculate distance between two positions
    calculateDistance(pos1, pos2) {
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const dz = pos1.z - pos2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    // Disconnect from server
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
        this.connected = false;
        this.clearAllRemotePlayers();
    }
}

// Export the MultiplayerManager class
window.MultiplayerManager = MultiplayerManager;
