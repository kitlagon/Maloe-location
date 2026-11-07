import test from 'node:test';
import assert from 'node:assert/strict';
import {dayNumber,reunionToday,period,shiftAnchor,bookingState,allocationsFor,buildPlanning} from '../planning-core.mjs';
const m=[{id:'fin',nom:'Palmes 38/41',stock:2,famille_code:'palmes',taille:'38/41'},{id:'mask',nom:'Easybreath S/M',stock:1,famille_code:'easybreath',taille:'S/M'}];
const component=[{produit_id:'kit',quantite:1,taille_requise:true,composant_code:'palmes'},{produit_id:'kit',quantite:1,taille_requise:true,composant_code:'easybreath'}];
function reservation(id,start,end,qty=1,extra={}) {return {id,date_retrait:start,date_retour:end,statut:'confirmee',reservation_items:[{quantite:qty,details:{allocations:[{materiel_id:'fin',qty}]}}],...extra};}
const input={materials:m,components:component,start:dayNumber('2026-11-01'),end:dayNumber('2026-11-30')};
test('dates, mois et changement d’année utilisent La Réunion',()=>{
 assert.equal(reunionToday(new Date('2026-11-07T21:00:00Z')),'2026-11-08');
 assert.equal(period('2026-11-07','week').start,dayNumber('2026-11-02'));
 assert.equal(period('2028-02-10','month').count,29);
 assert.equal(period('2026-11-07','quarter').count,92);
 assert.equal(shiftAnchor('2026-12-31','month',1),'2027-01-01');
 assert.ok(Number.isNaN(dayNumber('2026-02-31')));
});
test('une allocation totale ne multiplie pas une seconde fois les quantités',()=>{
 assert.deepEqual(allocationsFor({quantite:2,details:{allocations:[{materiel_id:'fin',qty:2}]}},m,component),{allocations:[{materialId:'fin',qty:2}],unresolved:false});
});
test('les anciens kits sont répartis avec leurs tailles sans deviner les tailles absentes',()=>{
 const r=allocationsFor({produit_id:'kit',quantite:1,details:{sizes:{palmes:'38/41',easybreath:'S/M'}}},m,component);
 assert.equal(r.allocations.length,2);assert.equal(r.unresolved,false);
 assert.equal(allocationsFor({produit_id:'kit',quantite:1,details:{}},m,component).unresolved,true);
});
test('trois locations simultanées pour deux unités signalent un dépassement',()=>{
 const p=buildPlanning({...input,reservations:['a','b','c'].map(id=>reservation(id,'2026-11-07','2026-11-09'))});
 assert.equal(p.groups[0].lanes.length,2);assert.equal(p.groups[0].overflow.length,1);assert.equal(p.warnings.length,1);
});
test('le jour du retour reste occupé comme le serveur et le lendemain libère la ligne',()=>{
 const p=buildPlanning({...input,reservations:[reservation('a','2026-11-07','2026-11-09'),reservation('b','2026-11-09','2026-11-10'),reservation('c','2026-11-10','2026-11-11')]});
 assert.deepEqual(p.groups[0].lanes.map(l=>l.map(e=>e.reservation.id)),[['a','c'],['b']]);
});
test('demandes expirées et annulations ne bloquent pas les lignes',()=>{
 const now=Date.parse('2026-11-07T10:00:00Z');
 const p=buildPlanning({...input,now,reservations:[reservation('expired','2026-11-07','2026-11-09',1,{statut:'en_attente_paiement',expires_at:'2026-11-07T09:59:00Z'}),reservation('cancel','2026-11-07','2026-11-09',1,{statut:'annulee'}),reservation('pending','2026-11-07','2026-11-09',1,{statut:'en_attente_paiement',expires_at:'2026-11-07T10:15:00Z'})]});
 assert.equal(p.excluded,2);assert.equal(p.events.length,1);assert.equal(p.events[0].state.key,'pending');
});
test('le stock nul affiche un dépassement, pas une disponibilité',()=>{
 const p=buildPlanning({...input,materials:[{...m[0],stock:0}],reservations:[reservation('a','2026-11-07','2026-11-08')]});
 assert.equal(p.groups[0].lanes.length,0);assert.equal(p.groups[0].overflow.length,1);
});
test('les tests peuvent être masqués et les EDL déterminent départ et retour',()=>{
 assert.equal(buildPlanning({...input,showTests:false,reservations:[reservation('test','2026-11-07','2026-11-08',1,{mode_test:true})]}).events.length,0);
 assert.equal(bookingState({statut:'confirmee',etats_des_lieux:[{type:'depart'}]}).key,'out');
 assert.equal(bookingState({statut:'confirmee',retour_effectif_at:'2026-11-07T08:00:00Z'}).key,'returned');
});
