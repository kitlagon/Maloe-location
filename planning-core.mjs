// Planning en lecture seule. Les numéros de lignes sont des repères, pas des affectations physiques.
export const DAY = 86400000;
export function reunionToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Indian/Reunion',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === value ? ms / DAY : NaN;
}
export function dateString(n) { return new Date(n * DAY).toISOString().slice(0,10); }
export function period(anchor, mode) {
  const d = new Date(anchor + 'T00:00:00Z');
  let start = dayNumber(anchor), count = 1;
  if (mode === 'week') { start -= (d.getUTCDay() + 6) % 7; count = 7; }
  if (mode === 'month' || mode === 'quarter') {
    d.setUTCDate(1); start = d.getTime() / DAY;
    const end = new Date(d); end.setUTCMonth(end.getUTCMonth() + (mode === 'quarter' ? 3 : 1));
    count = (end - d) / DAY;
  }
  return {start, end:start+count-1, count};
}
export function shiftAnchor(anchor, mode, direction) {
  const d = new Date(anchor + 'T00:00:00Z');
  if (mode === 'month' || mode === 'quarter') {
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + direction * (mode === 'quarter' ? 3 : 1));
  } else d.setUTCDate(d.getUTCDate() + direction * (mode === 'week' ? 7 : 1));
  return d.toISOString().slice(0,10);
}
export function bookingState(r, now = Date.now()) {
  const status = (r.statut || '').toLowerCase();
  if (/annul|cancel|refus|expir/.test(status)) return {key:'excluded',label:'Annulée ou expirée'};
  if (status === 'en_attente_paiement') {
    if (!r.expires_at || Date.parse(r.expires_at) <= now || !Number.isFinite(Date.parse(r.expires_at))) return {key:'excluded',label:'Demande expirée'};
    return {key:'pending',label:'Paiement en attente'};
  }
  const records = r.etats_des_lieux || [];
  if (r.retour_effectif_at || records.some(x=>x.type === 'retour') || /termin|clotur|clôtur/.test(status)) return {key:'returned',label:'Retourné'};
  if (records.some(x=>x.type === 'depart') || status === 'en_cours') return {key:'out',label:'Matériel retiré'};
  if (['confirmee','confirmée','payee','payée'].includes(status)) return {key:'confirmed',label:'Confirmée'};
  return {key:'unknown',label:r.statut || 'Statut à vérifier'};
}
export function paymentLabel(value) {
  return ({captured:'Paiement encaissé',authorized:'Paiement autorisé',to_capture:'Autorisé, à encaisser',not_created:'Paiement non créé',require_payment_method:'Moyen de paiement attendu',pending:'Paiement en attente',failed:'Paiement échoué',canceled:'Paiement annulé',cancelled:'Paiement annulé'})[value] || (value ? 'Statut de paiement : '+value : 'Paiement non renseigné');
}
export function allocationsFor(item, materials, components) {
  const details = item.details || {};
  if (Array.isArray(details.allocations) && details.allocations.length) {
    // qty est déjà le total de la ligne : ne pas multiplier une seconde fois par quantite.
    const valid = details.allocations.filter(a=>a.materiel_id && Number.isInteger(Number(a.qty)) && Number(a.qty)>0);
    return {allocations:valid.map(a=>({materialId:a.materiel_id,qty:Number(a.qty)})), unresolved:valid.length!==details.allocations.length};
  }
  const composition = components.filter(c=>c.produit_id === item.produit_id);
  if (!composition.length) return {allocations:[],unresolved:true};
  let unresolved = false;
  const allocations = [];
  for (const c of composition) {
    const size = details.sizes?.[c.composant_code];
    const candidates = materials.filter(m=>c.taille_requise ? m.famille_code === c.composant_code && m.taille === size && !!size : m.id === c.materiel_id);
    const qty = Number(c.quantite) * Number(item.quantite);
    if (candidates.length !== 1 || !Number.isInteger(qty) || qty < 1) { unresolved=true; continue; }
    allocations.push({materialId:candidates[0].id,qty});
  }
  return {allocations,unresolved};
}
export function buildPlanning({materials,components,reservations,start,end,showTests=true,now=Date.now()}) {
  const groups = new Map(materials.map(m=>[m.id,{material:m,lanes:Array.from({length:Math.max(0,Number(m.stock)||0)},()=>[]),overflow:[]}]));
  const warnings = [], events = [];
  let excluded=0;
  const sorted = [...reservations].sort((a,b)=>(a.date_retrait || '').localeCompare(b.date_retrait || '') || (a.id || '').localeCompare(b.id || ''));
  for (const r of sorted) {
    if (!showTests && r.mode_test) continue;
    const state = bookingState(r,now);
    if (state.key === 'excluded') {excluded++;continue;}
    const a=dayNumber(r.date_retrait), z=dayNumber(r.date_retour);
    if (!Number.isFinite(a)||!Number.isFinite(z)||z<a) {warnings.push({reservation:r,message:'Dates de réservation invalides.'});continue;}
    if (z<start||a>end) continue;
    const totals=new Map(); let unresolved=false;
    for (const item of r.reservation_items || []) {
      const resolved=allocationsFor(item,materials,components);
      unresolved ||= resolved.unresolved;
      for (const allocation of resolved.allocations) totals.set(allocation.materialId,(totals.get(allocation.materialId)||0)+allocation.qty);
    }
    if (!totals.size || unresolved) warnings.push({reservation:r,message:'Matériel ou taille à vérifier : cette réservation ne peut pas être entièrement placée.'});
    for (const [materialId,qty] of totals) {
      const g=groups.get(materialId);
      if (!g) {warnings.push({reservation:r,message:'Un matériel réservé est absent du catalogue.'});continue;}
      for(let i=0;i<qty;i++) {
        const event={reservation:r,start:a,end:z,state,material:g.material};
        // Même règle conservatrice que le stock serveur : le jour du retour reste occupé.
        const lane=g.lanes.find(l=>l.every(e=>e.end<a||e.start>z));
        if(lane) lane.push(event); else {g.overflow.push(event);warnings.push({reservation:r,message:'Stock dépassé pour '+g.material.nom+'.'});}
        events.push(event);
      }
    }
  }
  return {groups:[...groups.values()],warnings,events,excluded};
}
