import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : '*' }, maxHttpBufferSize: 10_000 });
const rooms = new Map();
const rate = new Map();
const PORT = Number(process.env.PORT) || 10000;
const TURN_TIMEOUT_MS = 30_000;
const ROOM_TTL_MS = 15 * 60_000;
const MIN_STAKE = 100;
const MAX_STAKE = 1_000_000;

app.disable('x-powered-by');
app.use(express.static('public', { etag: true, maxAge: '1h' }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const cleanName = (value) => String(value ?? '').trim().replace(/[<>]/g, '').slice(0, 18) || 'Joueur';
const cleanCode = (value) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const cleanClientKey = (value) => String(value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
const objectPayload = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const integer = (value, fallback) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const validStake = (value) => Math.min(MAX_STAKE, Math.max(MIN_STAKE, integer(value, MIN_STAKE)));
const roomCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const playerById = (room, id) => room.players.find((p) => p.id === id);
const currentPlayer = (room) => room.players[room.turnIndex];

function serialise(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    stake: room.stake,
    phase: room.phase,
    turn: currentPlayer(room)?.id ?? null,
    winner: room.winner,
    message: room.message,
    players: room.players.map(({ id, name, total, dice, connected, auto }) => ({ id, name, total, dice, connected, auto }))
  };
}
function emitState(room) { io.to(room.code).emit('state', serialise(room)); }
function clearTurnTimer(room) { if (room.turnTimer) clearTimeout(room.turnTimer); room.turnTimer = null; }
function scheduleTurn(room) {
  clearTurnTimer(room);
  if (room.phase !== 'playing' || !currentPlayer(room)) return;
  room.turnTimer = setTimeout(() => rollFor(room, currentPlayer(room).id, true), TURN_TIMEOUT_MS);
}
function nextUnplayed(room, fromIndex) { return room.players.findIndex((p, i) => i > fromIndex && p.total === null); }
function finishNormal(room) {
  const max = Math.max(...room.players.map((p) => p.total ?? -1));
  const winners = room.players.filter((p) => p.total === max);
  room.phase = 'finished'; room.winner = winners.map((p) => p.id);
  room.message = winners.length > 1 ? 'Égalité !' : `${winners[0].name} gagne la manche`;
  clearTurnTimer(room);
}
function rollFor(room, playerId, auto = false, abattage = false, opponentId = null, abattageStake = 100) {
  if (room.phase !== 'playing' || currentPlayer(room)?.id !== playerId) return false;
  const player = playerById(room, playerId); if (!player || player.total !== null) return false;
  const d1 = crypto.randomInt(1, 7), d2 = crypto.randomInt(1, 7), total = d1 + d2;
  player.dice = [d1, d2]; player.total = total; player.auto = auto;
  clearTurnTimer(room);
  if (d1 === 1 && d2 === 1) { room.phase = 'finished'; room.winner = [player.id]; room.message = 'MILLION !'; return true; }
  if (abattage) {
    const target = playerById(room, opponentId);
    room.message = target ? (total > 7 ? `${player.name} gagne l'abattage (${abattageStake} F)` : `${target.name} gagne l'abattage (${abattageStake} F)`) : `${player.name} a fait ${total}`;
  } else room.message = auto ? `${player.name} a lancé automatiquement` : `${player.name} a fait ${total}`;
  const next = nextUnplayed(room, room.turnIndex);
  if (next >= 0) { room.turnIndex = next; scheduleTurn(room); } else finishNormal(room);
  return true;
}
function makeRoom(socket, name, stake, clientKey) {
  let code = roomCode(); while (rooms.has(code)) code = roomCode();
  const room = { code, hostId: socket.id, stake: validStake(stake), phase: 'lobby', starterIndex: 0, turnIndex: 0, players: [], winner: null, message: '', turnTimer: null, lastActivity: Date.now() };
  room.players.push({ id: socket.id, clientKey: cleanClientKey(clientKey), name: cleanName(name), total: null, dice: null, connected: true, auto: false });
  rooms.set(code, room); return room;
}
function getRoom(socket) { return rooms.get(socket.data.roomCode); }
function touch(room) { room.lastActivity = Date.now(); }
function limited(socket, event) {
  const key = `${socket.id}:${event}`, now = Date.now(), previous = rate.get(key) ?? [];
  const fresh = previous.filter((t) => now - t < 10_000); fresh.push(now); rate.set(key, fresh);
  return fresh.length <= (event === 'roll' ? 12 : 20);
}
function sendError(socket, message, ack) { socket.emit('errorMessage', message); if (typeof ack === 'function') ack({ ok: false, message }); }

io.on('connection', (socket) => {
  socket.on('create', (payload = {}, ack) => {
    payload = objectPayload(payload);
    if (!limited(socket, 'create') || socket.data.roomCode) return sendError(socket, 'Action impossible', ack);
    const room = makeRoom(socket, payload.name, payload.stake, payload.clientKey); socket.join(room.code); socket.data.roomCode = room.code;
    socket.emit('joined', { code: room.code, host: true }); emitState(room); if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('join', (payload = {}, ack) => {
    payload = objectPayload(payload);
    if (!limited(socket, 'join') || socket.data.roomCode) return sendError(socket, 'Action impossible', ack);
    const room = rooms.get(cleanCode(payload.code));
    if (!room) return sendError(socket, 'Table introuvable', ack);
    if (room.phase !== 'lobby') return sendError(socket, 'Manche en cours', ack);
    if (room.players.length >= 5) return sendError(socket, 'Table complète', ack);
    const clientKey = cleanClientKey(payload.clientKey);
    if (clientKey && room.players.some((p) => p.clientKey === clientKey)) return sendError(socket, 'Ce joueur est déjà à cette table', ack);
    if (room.players.some((p) => p.name.toLowerCase() === cleanName(payload.name).toLowerCase())) return sendError(socket, 'Nom déjà pris', ack);
    room.players.push({ id: socket.id, clientKey, name: cleanName(payload.name), total: null, dice: null, connected: true, auto: false });
    touch(room); socket.join(room.code); socket.data.roomCode = room.code; socket.emit('joined', { code: room.code, host: false }); emitState(room); if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('start', (_payload = {}, ack) => {
    const room = getRoom(socket); if (!room || !limited(socket, 'start')) return sendError(socket, 'Action impossible', ack);
    if (room.hostId !== socket.id) return sendError(socket, 'Seul le créateur peut démarrer', ack);
    if (room.players.length < 2) return sendError(socket, 'Il faut 2 joueurs', ack);
    if (room.players.some((p) => !p.connected)) return sendError(socket, 'Un joueur est déconnecté', ack);
    room.phase = 'playing'; room.turnIndex = room.starterIndex; room.winner = null; room.message = ''; touch(room); scheduleTurn(room); emitState(room); if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('roll', (payload = {}, ack) => {
    payload = objectPayload(payload);
    const room = getRoom(socket); if (!room || !limited(socket, 'roll')) return sendError(socket, 'Action impossible', ack);
    if (room.phase !== 'playing') return sendError(socket, 'La manche est terminée', ack);
    if (currentPlayer(room)?.id !== socket.id) return sendError(socket, "Ce n'est pas votre tour", ack);
    const useAbattage = payload.abattage === true;
    const opponent = playerById(room, payload.opponent);
    if (useAbattage && (!opponent || opponent.id === socket.id || !opponent.connected)) return sendError(socket, 'Adversaire invalide', ack);
    const abattageStake = validStake(payload.abattageStake);
    if (!rollFor(room, socket.id, false, useAbattage, opponent?.id, abattageStake)) return sendError(socket, 'Lancer refusé', ack);
    touch(room); emitState(room); if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('newRound', (_payload = {}, ack) => {
    const room = getRoom(socket); if (!room || !limited(socket, 'newRound')) return sendError(socket, 'Action impossible', ack);
    if (room.phase !== 'finished' || room.hostId !== socket.id) return sendError(socket, 'Seul l’hôte peut relancer', ack);
    if (room.players.length < 2 || room.players.some((p) => !p.connected)) return sendError(socket, 'Tous les joueurs doivent être présents', ack);
    room.starterIndex = (room.starterIndex + 1) % room.players.length;
    room.phase = 'playing'; room.turnIndex = room.starterIndex; room.winner = null; room.message = 'Nouvelle manche';
    room.players.forEach((p) => { p.total = null; p.dice = null; p.auto = false; }); touch(room); scheduleTurn(room); emitState(room); if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('disconnect', () => {
    const room = getRoom(socket); if (!room) return;
    const player = playerById(room, socket.id); if (player) player.connected = false; rate.delete(`${socket.id}:roll`);
    if (room.hostId === socket.id) room.hostId = room.players.find((p) => p.connected)?.id ?? room.hostId;
    if (room.phase === 'playing' && currentPlayer(room)?.id === socket.id) scheduleTurn(room);
    emitState(room);
  });
});
setInterval(() => { const now = Date.now(); for (const [code, room] of rooms) if (now - room.lastActivity > ROOM_TTL_MS) { clearTurnTimer(room); rooms.delete(code); } }, 60_000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Jeu de dés sur le port ${PORT}`));
