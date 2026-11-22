import assert from 'node:assert/strict';
import test from 'node:test';
import {
  packLinePrice, packQuantities, packRentalDays, packStartingPrice,
} from '../supabase/functions/_shared/family-pack.mjs';

test('les prix validés progressent chaque jour pour deux ou quatre kits', () => {
  const durations = [1, 2, 3, 4, 5, 6, 7];
  const prices = kits => durations.map(days => Math.round(packStartingPrice(days, kits) * 100));
  assert.deepEqual(prices(2), [3870, 7200, 9630, 11700, 13230, 14580, 15750]);
  assert.deepEqual(prices(4), [6750, 12600, 16830, 20340, 22950, 25200, 27090]);
});

test('tous les kits supplémentaires sont remisés, même de types différents', () => {
  const lines = [
    { id: 'parasol', qty: 2 }, { id: 'glaciere', qty: 1 },
    { id: 'pmt', qty: 3 }, { id: 'palme-easy', qty: 2 }, { id: 'palmes', qty: 1 },
  ];
  assert.deepEqual(packQuantities(lines, true), [1, 1, 3, 2, 0]);
  assert.deepEqual(packQuantities(lines, false), [0, 0, 0, 0, 0]);
  assert.deepEqual(packQuantities(lines.filter(line => line.id !== 'glaciere'), true), [0, 0, 0, 0]);
  assert.equal(packLinePrice('parasol', 2, 1, 1, 6), 10.5);
});

test('la durée facturée reprend la règle du retrait à 17 h 30', () => {
  assert.equal(packRentalDays('2026-11-22', '2026-11-23', '17:15'), 2);
  assert.equal(packRentalDays('2026-11-22', '2026-11-23', '17:30'), 1);
  assert.equal(packRentalDays('2026-11-22', '2026-11-22', '17:30'), 1);
});
