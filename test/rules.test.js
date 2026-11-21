import test from 'node:test';
import assert from 'node:assert/strict';

const finish = (totals) => { const max = Math.max(...totals); return totals.map((t, i) => t === max ? i : -1).filter((i) => i >= 0); };
const million = (dice) => dice[0] === 1 && dice[1] === 1;
const abattageWinner = (total, player, opponent) => total > 7 ? player : opponent;

test('manche à 2 joueurs : le plus gros total gagne', () => assert.deepEqual(finish([8, 6]), [0]));
test('manche à 3, 4 et 5 joueurs', () => { assert.deepEqual(finish([4, 8, 6]), [1]); assert.deepEqual(finish([9, 3, 7, 5]), [0]); assert.deepEqual(finish([2, 5, 12, 8, 4]), [2]); });
test('égalité partielle et totale', () => { assert.deepEqual(finish([9, 9, 4]), [0, 1]); assert.deepEqual(finish([7, 7, 7]), [0, 1, 2]); });
test('Million détecté sur 1 et 1 seulement', () => { assert.equal(million([1, 1]), true); assert.equal(million([1, 2]), false); });
test('abattage gagné au-dessus de 7 et perdu à 7 ou moins', () => { assert.equal(abattageWinner(8, 'A', 'B'), 'A'); assert.equal(abattageWinner(7, 'A', 'B'), 'B'); assert.equal(abattageWinner(2, 'A', 'B'), 'B'); });
test('une égalité conserve tous les gagnants', () => assert.deepEqual(finish([10, 10, 3, 4, 10]), [0, 1, 4]));
