// Délai de préparation validé le 22/11/2026 — heure locale de La Réunion.
// La règle semaine/week-end dépend du jour où le client réserve.
const TZ = 'Indian/Reunion';
export function reunionNowParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short'
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return { date: parts.year+'-'+parts.month+'-'+parts.day,
    minutes: Number(parts.hour)*60+Number(parts.minute),
    weekday: parts.weekday };
}
function nextDay(iso) {
  const d = new Date(iso+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}
export function earliestPickup(now = new Date()) {
  const p = reunionNowParts(now);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') {
    // Calcul à la minute réelle (et non à la minute tronquée).
    return new Date(now.getTime()+3*60*60*1000);
  }
  let date=p.date, time;
  if (p.minutes<=600) time='13:00';
  else if (p.minutes<=870) time='17:30';
  else if (p.minutes<=1170) {date=nextDay(date);time='07:45';}
  else {date=nextDay(date);time='08:00';}
  return new Date(date+'T'+time+':00+04:00');
}
export function pickupAllowed(date, time, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false;
  const pickup=new Date(date+'T'+time+':00+04:00');
  return Number.isFinite(pickup.getTime()) && pickup.getTime()>=earliestPickup(now).getTime();
}
