import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new Map();
const PORT = process.env.PORT || 10000;

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function roomState(room) {
  return {
    code: room.code,
    stake: room.stake,
    phase: room.phase,
    players: room.players.map((p) => ({ id: p.id, name: p.name, total: p.total, dice: p.dice, connected: p.connected })),
    turn: room.players[room.turn]?.id ?? null,
    winner: room.winner ?? null,
    message: room.message ?? ''
  };
}
function broadcast(room) { io.to(room.code).emit('state', roomState(room)); }
function resetRound(room) {
  room.phase = 'lobby'; room.turn = 0; room.winner = null; room.message = '';
  room.players.forEach((p) => { p.total = null; p.dice = null; p.connected = true; });
}
function getRoom(socket) { return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null; }

io.on('connection', (socket) => {
  socket.on('create', ({ name, stake }) => {
    const clean = String(name || 'Joueur').trim().slice(0, 18) || 'Joueur';
    let roomCode = code(); while (rooms.has(roomCode)) roomCode = code();
    const room = { code: roomCode, stake: Math.max(100, Math.floor(Number(stake) || 100)), phase: 'lobby', turn: 0, players: [], winner: null, message: '' };
    room.players.push({ id: socket.id, name: clean, total: null, dice: null, connected: true });
    rooms.set(roomCode, room); socket.join(roomCode); socket.data.roomCode = roomCode; socket.emit('joined', { code: roomCode, host: true }); broadcast(room);
  });

  socket.on('join', ({ name, code: roomCode }) => {
    const room = rooms.get(String(roomCode || '').toUpperCase());
    if (!room) return socket.emit('errorMessage', 'Table introuvable');
    if (room.phase !== 'lobby') return socket.emit('errorMessage', 'Manche en cours');
    if (room.players.length >= 5) return socket.emit('errorMessage', 'Table complète');
    const clean = String(name || 'Joueur').trim().slice(0, 18) || 'Joueur';
    room.players.push({ id: socket.id, name: clean, total: null, dice: null, connected: true });
    socket.join(room.code); socket.data.roomCode = room.code; socket.emit('joined', { code: room.code, host: false }); broadcast(room);
  });

  socket.on('start', () => {
    const room = getRoom(socket); if (!room || room.players[0]?.id !== socket.id) return;
    if (room.players.length < 2) return socket.emit('errorMessage', 'Il faut 2 joueurs');
    room.phase = 'playing'; room.turn = 0; room.message = ''; broadcast(room);
  });

  socket.on('roll', ({ abattage, opponent }) => {
    const room = getRoom(socket); if (!room || room.phase !== 'playing') return;
    if (room.players[room.turn]?.id !== socket.id) return socket.emit('errorMessage', "Ce n'est pas votre tour");
    const p = room.players[room.turn];
    if (abattage && (!room.players.some((x) => x.id === opponent) || opponent === p.id)) return socket.emit('errorMessage', 'Adversaire invalide');
    const d1 = crypto.randomInt(1, 7), d2 = crypto.randomInt(1, 7), total = d1 + d2;
    p.dice = [d1, d2]; p.total = total;
    if (d1 === 1 && d2 === 1) { room.phase = 'finished'; room.winner = p.id; room.message = 'MILLION !'; broadcast(room); return; }
    if (abattage) {
      const target = room.players.find((x) => x.id === opponent);
      room.message = total > 7 ? `${p.name} gagne l'abattage` : `${target.name} gagne l'abattage`;
    } else room.message = `${p.name} a fait ${total}`;
    const next = room.players.findIndex((x, i) => i > room.turn && x.total === null);
    if (next !== -1) room.turn = next;
    else {
      room.phase = 'finished';
      const max = Math.max(...room.players.map((x) => x.total ?? -1));
      const winners = room.players.filter((x) => x.total === max);
      room.winner = winners.map((x) => x.id);
      room.message = winners.length > 1 ? 'Égalité !' : `${winners[0].name} gagne la manche`;
    }
    broadcast(room);
  });

  socket.on('newRound', () => { const room = getRoom(socket); if (!room || room.phase !== 'finished' || room.players[0]?.id !== socket.id) return; resetRound(room); broadcast(room); });
  socket.on('disconnect', () => { const room = getRoom(socket); if (!room) return; const p = room.players.find((x) => x.id === socket.id); if (p) p.connected = false; broadcast(room); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Jeu de dés sur le port ${PORT}`));
