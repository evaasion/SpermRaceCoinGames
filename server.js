const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Game state
const players = {};
const nutrients = [];
const MAX_NUTRIENTS = 150;
const MIN_NUTRIENTS = 100;
const ARENA_SIZE = { width: 5000, height: 5000 }; // Agrandi à 5000x5000
const EGG_POSITION = { x: ARENA_SIZE.width / 2, y: ARENA_SIZE.height / 2 };

// Initialize nutrient
function createNutrient(id) {
  return {
    id: id || Date.now().toString() + Math.random().toString(36).substr(2, 5),
    x: Math.random() * ARENA_SIZE.width * 0.8 + ARENA_SIZE.width * 0.1,
    y: Math.random() * ARENA_SIZE.height * 0.8 + ARENA_SIZE.height * 0.1,
    size: Math.random() * 5 + 3,
    color: ['#4CAF50', '#2196F3', '#FFC107', '#E91E63'][Math.floor(Math.random() * 4)],
  };
}

// Generate initial nutrients
function generateInitialNutrients() {
  for (let i = 0; i < MAX_NUTRIENTS; i++) {
    nutrients.push(createNutrient());
  }
  console.log('Generated initial nutrients:', nutrients.length);
}

// Update leaderboard
function updateLeaderboard() {
  const scores = Object.entries(players).map(([id, player]) => ({
    id,
    name: player.name,
    score: player.score || 0,
    nutrientsCollected: player.nutrientsCollected || 0,
    kills: player.kills || 0,
  }));
  return scores.sort((a, b) => b.score - a.score).slice(0, 10);
}

// Check for player collisions and handle kills
function checkPlayerCollisions() {
  const playerIds = Object.keys(players);
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const player1 = players[playerIds[i]];
      const player2 = players[playerIds[j]];
      const dx = player1.x - player2.x;
      const dy = player1.y - player2.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const collisionDistance = (player1.size + player2.size) * 1.2;

      if (distance < collisionDistance) {
        // Determine which player is larger
        if (player1.size > player2.size + 2) { // Player1 is significantly larger
          player1.kills = (player1.kills || 0) + 1;
          player1.score += 50; // Bonus for a kill
          io.emit('playerUpdated', { id: playerIds[i], player: player1 });

          // Respawn player2
          player2.x = Math.random() * ARENA_SIZE.width * 0.8 + ARENA_SIZE.width * 0.1;
          player2.y = Math.random() * ARENA_SIZE.height * 0.8 + ARENA_SIZE.height * 0.1;
          player2.size = 10; // Reset size
          player2.score = Math.max(0, (player2.score || 0) - 20); // Lose some score
          io.emit('playerUpdated', { id: playerIds[j], player: player2 });
        } else if (player2.size > player1.size + 2) { // Player2 is significantly larger
          player2.kills = (player2.kills || 0) + 1;
          player2.score += 50;
          io.emit('playerUpdated', { id: playerIds[j], player: player2 });

          // Respawn player1
          player1.x = Math.random() * ARENA_SIZE.width * 0.8 + ARENA_SIZE.width * 0.1;
          player1.y = Math.random() * ARENA_SIZE.height * 0.8 + ARENA_SIZE.height * 0.1;
          player1.size = 10;
          player1.score = Math.max(0, (player1.score || 0) - 20);
          io.emit('playerUpdated', { id: playerIds[i], player: player1 });
        }
      }
    }
  }
}

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Initialize game state
generateInitialNutrients();

io.on('connection', (socket) => {
  console.log(`New player connected: ${socket.id}`);

  // Handle player joining with name and color
  socket.on('playerJoin', ({ name, color }) => {
    players[socket.id] = {
      x: Math.random() * ARENA_SIZE.width * 0.8 + ARENA_SIZE.width * 0.1,
      y: Math.random() * ARENA_SIZE.height * 0.8 + ARENA_SIZE.height * 0.1,
      angle: 0,
      targetAngle: 0,
      score: 0,
      size: 10,
      name: name || `Player${socket.id.slice(0, 4)}`,
      color: color || `hsl(${Math.random() * 360}, 70%, 50%)`,
      nutrientsCollected: 0, // Compteur pour les nutriments
      kills: 0, // Compteur pour les kills
    };

    // Send initial game state to the new player
    socket.emit('init', {
      id: socket.id,
      players,
      nutrients,
      egg: EGG_POSITION,
      leaderboard: updateLeaderboard(),
    });

    // Notify other players of the new player
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });
  });

  // Handle player movement
  socket.on('playerMove', (data) => {
    if (!players[socket.id]) return;

    // Validate movement to prevent cheating
    const maxSpeed = 5;
    const dx = data.x - players[socket.id].x;
    const dy = data.y - players[socket.id].y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxSpeed) {
      socket.emit('invalidMove');
      return;
    }

    players[socket.id].x = Math.max(0, Math.min(ARENA_SIZE.width, data.x));
    players[socket.id].y = Math.max(0, Math.min(ARENA_SIZE.height, data.y));
    players[socket.id].angle = data.angle;
    players[socket.id].targetAngle = data.targetAngle;

    socket.broadcast.emit('playerMoved', { id: socket.id, player: players[socket.id] });

    // Check if player reached the egg
    const eggDx = players[socket.id].x - EGG_POSITION.x;
    const eggDy = players[socket.id].y - EGG_POSITION.y;
    const eggDistance = Math.sqrt(eggDx * eggDx + eggDy * eggDy);
    if (eggDistance < players[socket.id].size + 20) {
      players[socket.id].score += 100;
      io.emit('playerUpdated', { id: socket.id, player: players[socket.id] });
      io.emit('leaderboardUpdate', updateLeaderboard());
      socket.emit('reachEgg');
    }
  });

  // Handle nutrient collection
  socket.on('nutrientCollected', (nutrientId) => {
    const index = nutrients.findIndex((n) => n.id === nutrientId);
    if (index === -1) return;

    // Validate distance
    const player = players[socket.id];
    const nutrient = nutrients[index];
    const dx = player.x - nutrient.x;
    const dy = player.y - nutrient.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > (player.size + nutrient.size) * 1.5) return;

    // Update player score, size, and nutrients collected
    player.score += 10;
    player.size = Math.min(30, player.size + 0.5);
    player.nutrientsCollected = (player.nutrientsCollected || 0) + 1;

    // Replace the collected nutrient
    nutrients.splice(index, 1);
    const newNutrient = createNutrient();
    nutrients.push(newNutrient);

    // Notify all clients
    io.emit('nutrientUpdate', { removed: nutrientId, added: newNutrient });
    io.emit('playerUpdated', { id: socket.id, player: player });
    io.emit('leaderboardUpdate', updateLeaderboard());
  });

  // Handle player disconnection
  socket.on('disconnect', () => {
    console.log(`Player left: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    io.emit('leaderboardUpdate', updateLeaderboard());
  });
});

// Periodically update nutrient positions, check collisions, and ensure minimum nutrients
setInterval(() => {
  // Déplacer les nutriments existants
  nutrients.forEach((nutrient) => {
    nutrient.x += (Math.random() - 0.5) * 2;
    nutrient.y += (Math.random() - 0.5) * 2;
    nutrient.x = Math.max(0, Math.min(ARENA_SIZE.width, nutrient.x));
    nutrient.y = Math.max(0, Math.min(ARENA_SIZE.height, nutrient.y));
  });

  // Ajouter des nutriments si leur nombre est inférieur au seuil minimum
  while (nutrients.length < MIN_NUTRIENTS) {
    const newNutrient = createNutrient();
    nutrients.push(newNutrient);
    io.emit('nutrientUpdate', { added: newNutrient });
  }

  // Vérifier les collisions entre joueurs
  checkPlayerCollisions();

  io.emit('nutrientUpdate', { fullUpdate: nutrients });
  io.emit('leaderboardUpdate', updateLeaderboard());
}, 2000);

server.listen(3000, () => {
  console.log('SpermRace server running on http://localhost:3000');
});
