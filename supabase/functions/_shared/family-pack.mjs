export const familyKitIds = ['pmt', 'palme-easy'];

const packPrices = {
  parasol: [5, 9, 12, 15, 17, 19, 21],
  glaciere: [6, 11, 15, 19, 22, 25, 28],
  pmt: [16, 30, 40, 48, 54, 59, 63],
  'palme-easy': [16, 30, 40, 48, 54, 59, 63],
};

export function packUnitPrice(id, days) {
  const rates = packPrices[id];
  const last = rates.length - 1;
  const extended = Math.max(0, days - rates.length) * (rates[last] - rates[last - 1]);
  return (rates[Math.min(days, rates.length) - 1] + extended) * 90 / 100;
}

export function packStartingPrice(days, kits = 2) {
  return packUnitPrice('parasol', days) + packUnitPrice('glaciere', days)
    + kits * packUnitPrice('pmt', days);
}

export function packRentalDays(retrait, retour, slotRetrait) {
  const gap = Math.round((Date.parse(retour) - Date.parse(retrait)) / 86400000);
  return Math.max(1, gap + 1 - (slotRetrait >= '17:30' ? 1 : 0));
}

export function packQuantities(lines, requested) {
  const discounted = lines.map(() => 0);
  if (requested !== true) return discounted;
  const valid = lines.filter(line => line && Number.isInteger(Number(line.qty)) && Number(line.qty) > 0);
  const parasol = lines.findIndex(line => valid.includes(line) && line.id === 'parasol');
  const cooler = lines.findIndex(line => valid.includes(line) && line.id === 'glaciere');
  const kits = valid.filter(line => familyKitIds.includes(line.id));
  if (parasol === -1 || cooler === -1 || kits.reduce((qty, line) => qty + Number(line.qty), 0) < 2) {
    return discounted;
  }
  discounted[parasol] = discounted[cooler] = 1;
  lines.forEach((line, index) => {
    if (kits.includes(line)) discounted[index] = Number(line.qty);
  });
  return discounted;
}

export function packLinePrice(id, qty, discounted, days, regularPrice) {
  const packPrice = discounted ? packUnitPrice(id, days) * discounted : 0;
  return Math.round((packPrice + regularPrice * (qty - discounted)) * 100) / 100;
}
