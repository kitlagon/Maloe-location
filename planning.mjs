import {DAY,reunionToday,dayNumber,dateString,period,shiftAnchor,bookingState,paymentLabel,buildPlanning} from './planning-core.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel=(n,options)=>new Date(n*DAY).toLocaleDateString('fr-FR',{...options,timeZone:'UTC'});
const person=r=>[r.client?.prenom,r.client?.nom].filter(Boolean).join(' ')||'Client non renseigné';
let mode='week',anchor=reunionToday(),materials=[],components=[],reservations=[],collapsed=new Set(),authorized=false,requestId=0,client;
let detailId=null;
function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function clearPrivate(){authorized=false;requestId++;materials=[];components=[];reservations=[];detailId=null;$('calendar').replaceChildren();$('warnings').replaceChildren();$('detail-content').replaceChildren();if($('detail').open)$('detail').close();$('app').hidden=true;$('logout').hidden=true;$('login-panel').hidden=false;}
async function rows(queryFactory){let result=[];for(let i=0;;i+=500){const {data,error}=await queryFactory().range(i,i+499);if(error)throw error;result.push(...data);if(data.length<500)return result;}}
async function load(){
  const ticket=++requestId;
  $('refresh').disabled=true;status('Chargement des réservations et des stocks…');
  try{
    const {data:user,error:authError}=await client.auth.getUser();
    if(ticket!==requestId)return;
    if(authError||!user.user){clearPrivate();status('Connecte-toi pour consulter le planning.');return;}
    const {data:allowed,error:permissionError}=await client.rpc('is_admin');
    if(ticket!==requestId)return;
    if(permissionError||allowed!==true){clearPrivate();$('logout').hidden=false;status('Ce compte ne dispose pas de l’accès administrateur au planning.',true);return;}
    const view=period(anchor,mode);
    const [ms,cs,rs]=await Promise.all([
      rows(()=>client.from('materiels').select('id,code,nom,stock,actif,famille_code,taille').order('code').order('id')),
      rows(()=>client.from('produit_composants').select('id,produit_id,materiel_id,quantite,taille_requise,composant_code').order('id')),
      rows(()=>client.from('reservations').select('id,date_retrait,date_retour,heure_retrait,heure_retour,total,caution,statut,expires_at,paiement_confirme_at,mode_test,retour_effectif_at,stancer_payment_status,client:clients(nom,prenom,telephone,email),reservation_items(id,produit_id,quantite,details,produit:produits(nom)),etats_des_lieux(type,date_realisation)').lte('date_retrait',dateString(view.end)).gte('date_retour',dateString(view.start)).order('date_retrait').order('id'))
    ]);
    if(ticket!==requestId)return;
    materials=ms;components=cs;reservations=rs.map(r=>({...r,client:Array.isArray(r.client)?r.client[0]:r.client}));authorized=true;
    $('app').hidden=false;$('login-panel').hidden=true;$('logout').hidden=false;
    $('updated').textContent='Actualisé à '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Indian/Reunion'})+' · La Réunion';
    render();status('');
    if(detailId){const r=reservations.find(r=>r.id===detailId);if(r)openDetail(r);else $('detail').close();}
  }catch(error){
    if(ticket!==requestId)return;
    // Ne jamais présenter une ancienne période ou un ancien stock comme une lecture réussie.
    materials=[];components=[];reservations=[];$('calendar').replaceChildren();$('warnings').replaceChildren();$('detail-content').replaceChildren();if($('detail').open)$('detail').close();detailId=null;$('app').hidden=true;
    status('Impossible de charger le planning. '+(error?.message||'Vérifie ta connexion puis réessaie.'),true);
    $('login-panel').hidden=false;$('logout').hidden=false;
  }finally{if(ticket===requestId)$('refresh').disabled=false;}
}
function familyName(code){return ({palmes:'Palmes','masque-tuba':'Masques & tubas',easybreath:'Easybreath','parasol-mat':'Parasols','glaciere-mat':'Glacières',camera:'Caméra 360°'})[code]||code||'Autres matériels';}
function render(){
  if(!authorized)return;
  const view=period(anchor,mode),today=dayNumber(reunionToday());
  const plan=buildPlanning({materials,components,reservations,start:view.start,end:view.end,showTests:$('tests').checked});
  const dayWidth=mode==='day'?560:mode==='week'?100:mode==='month'?72:52;
  const cal=$('calendar');cal.style.setProperty('--count',view.count);cal.style.setProperty('--day',dayWidth+'px');
  $('jump').value=anchor;
  $('period-title').textContent=mode==='day'?dateLabel(view.start,{weekday:'long',day:'numeric',month:'long',year:'numeric'}):dateLabel(view.start,{day:'numeric',month:'short'})+' – '+dateLabel(view.end,{day:'numeric',month:'short',year:'numeric'});
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===mode));
  let html='<div class="row dates-row"><div class="label">MATÉRIEL / UNITÉ</div><div class="dates" style="grid-template-columns:repeat('+view.count+',1fr)">';
  for(let d=view.start;d<=view.end;d++){const weekday=new Date(d*DAY).getUTCDay();html+='<div class="date '+((weekday===0||weekday===6)?'weekend ':'')+(d===today?'today':'')+'">'+esc(dateLabel(d,{weekday:'short'}))+'<strong>'+esc(dateLabel(d,{day:'numeric',month:mode==='quarter'?'numeric':undefined}))+'</strong></div>';}
  html+='</div></div>';
  const families=new Map();
  for(const g of plan.groups){const code=g.material.famille_code||g.material.code||'Autres matériels';if(!families.has(code))families.set(code,[]);families.get(code).push(g);}
  const order=['palmes','masque-tuba','easybreath','parasol-mat','glaciere-mat','camera'];
  const familyEntries=[...families].sort((a,b)=>(order.indexOf(a[0])<0?99:order.indexOf(a[0]))-(order.indexOf(b[0])<0?99:order.indexOf(b[0]))||a[0].localeCompare(b[0]));
  for(const [code,gs] of familyEntries){
    const total=gs.reduce((n,g)=>n+g.lanes.length,0);
    html+='<button class="group-row" data-group="'+esc(code)+'" aria-expanded="'+!collapsed.has(code)+'"><span>'+(collapsed.has(code)?'＋':'−')+' '+esc(familyName(code))+'<small>'+total+' unité'+(total>1?'s':'')+'</small></span></button>';
    if(collapsed.has(code))continue;
    for(const g of gs){
      const label=g.material.nom;
      if(!g.lanes.length)html+='<div class="row"><div class="label zero">'+esc(label)+'</div><div class="lane"><span class="empty-lane">Stock 0 · indisponible</span></div></div>';
      g.lanes.forEach((events,index)=>{html+='<div class="row"><div class="label">'+esc(label)+' · n°'+(index+1)+(g.material.actif?'':' <small>(inactif)</small>')+'</div><div class="lane">'+events.map(e=>bar(e,view)).join('')+'</div></div>';});
      // Les dépassements ont chacun une ligne : aucune réservation ne doit masquer une autre.
      g.overflow.forEach(e=>{html+='<div class="row"><div class="label warning-text">'+esc(label)+' · dépassement</div><div class="lane">'+bar(e,view,true)+'</div></div>';});
    }
  }
  if(!plan.groups.length)html+='<p class="empty-lane">Aucun matériel enregistré.</p>';
  cal.innerHTML=html;
  cal.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{collapsed.has(b.dataset.group)?collapsed.delete(b.dataset.group):collapsed.add(b.dataset.group);render();});
  cal.querySelectorAll('[data-reservation]').forEach(b=>b.onclick=()=>{const r=reservations.find(r=>r.id===b.dataset.reservation);if(r)openDetail(r);});
  const visible=reservations.filter(r=>($('tests').checked||!r.mode_test)&&bookingState(r).key!=='excluded');
  $('summary').textContent=visible.length?visible.length+' réservation'+(visible.length>1?'s':'')+' sur la période · '+plan.excluded+' demande(s) expirée(s) ou annulée(s) exclue(s).':'Aucune réservation à afficher sur cette période.';
  const unique=[...new Map(plan.warnings.map(w=>[w.reservation.id+':'+w.message,w])).values()];
  $('warnings').hidden=!unique.length;
  $('warnings').innerHTML=unique.length?'<h3>À vérifier avant de confirmer les disponibilités</h3>'+unique.map((w,i)=>'<button data-warning="'+i+'">'+esc(person(w.reservation))+' — '+esc(w.message)+'</button>').join(''):'';
  $('warnings').querySelectorAll('[data-warning]').forEach(b=>b.onclick=()=>openDetail(unique[Number(b.dataset.warning)].reservation));
}
function bar(e,view,conflict=false){
  const a=Math.max(view.start,e.start),z=Math.min(view.end,e.end)+1;
  const r=e.reservation,text=person(r)+(r.mode_test?' · TEST':'');
  const label=text+' · '+e.state.label+' · '+r.date_retrait+' '+(r.heure_retrait||'heure non renseignée')+' au '+r.date_retour+' '+(r.heure_retour||'heure non renseignée');
  return '<button class="bar '+e.state.key+(conflict?' conflict':'')+'" data-reservation="'+esc(r.id)+'" style="left:calc('+((a-view.start)/view.count*100)+'% + 2px);width:calc('+((z-a)/view.count*100)+'% - 4px)" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+esc(text)+'</button>';
}
function openDetail(r){
  detailId=r.id;const state=bookingState(r);
  const money=v=>v==null?'Non renseigné':Number(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
  const when=(date,time)=>dateLabel(dayNumber(date),{day:'numeric',month:'long',year:'numeric'})+' à '+(time||'heure non renseignée');
  const records=r.etats_des_lieux||[];
  const edl=['depart','retour'].map(t=>(t==='depart'?'Départ':'Retour')+' : '+(records.some(x=>x.type===t)?'enregistré':'à réaliser')).join(' · ');
  $('detail-content').innerHTML='<div class="detail-title">'+esc(person(r))+'</div>'+(r.mode_test?'<span class="test-badge">Réservation marquée test</span>':'')+'<dl><dt>Référence</dt><dd>'+esc(r.id)+'</dd><dt>Statut</dt><dd>'+esc(state.label)+'</dd><dt>Retrait</dt><dd>'+esc(when(r.date_retrait,r.heure_retrait))+'</dd><dt>Retour prévu</dt><dd>'+esc(when(r.date_retour,r.heure_retour))+'</dd><dt>Téléphone</dt><dd>'+esc(r.client?.telephone||'Non renseigné')+'</dd><dt>E-mail</dt><dd>'+esc(r.client?.email||'Non renseigné')+'</dd><dt>Location</dt><dd>'+money(r.total)+'</dd><dt>Paiement</dt><dd>'+esc(paymentLabel(r.stancer_payment_status))+'</dd><dt>Caution</dt><dd>'+money(r.caution)+' · à vérifier au retrait</dd><dt>États des lieux</dt><dd>'+esc(edl)+'</dd></dl><h3>Matériel réservé</h3><ul>'+(r.reservation_items||[]).map(i=>{const p=Array.isArray(i.produit)?i.produit[0]:i.produit;const sizes=Object.entries(i.details?.sizes||{}).map(([k,v])=>k+' : '+v).join(', ');return '<li>'+esc(i.quantite)+' × '+esc(p?.nom||'Produit non renseigné')+(sizes?' · '+esc(sizes):'')+'</li>';}).join('')+'</ul>';
  if(!$('detail').open)$('detail').showModal();
}
$('close-detail').onclick=()=>$('detail').close();$('detail').addEventListener('close',()=>{detailId=null;});
for(const [id,action] of [['prev',()=>{anchor=shiftAnchor(anchor,mode,-1);}],['next',()=>{anchor=shiftAnchor(anchor,mode,1);}],['today',()=>{anchor=reunionToday();}]])$(id).onclick=()=>{action();load();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{mode=b.dataset.view;load();});
$('jump').onchange=()=>{if(Number.isFinite(dayNumber($('jump').value))){anchor=$('jump').value;load();}};
$('tests').onchange=()=>render();$('refresh').onclick=()=>load();
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!client)return;const b=$('login-button');b.disabled=true;status('Connexion…');
  try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});$('password').value='';if(error)throw error;await load();}
  catch(error){status('Connexion impossible. Vérifie ton adresse e-mail et ton mot de passe.',true);}
  finally{b.disabled=false;}
});
$('logout').onclick=async()=>{clearPrivate();status('Déconnexion…');try{const {error}=await client.auth.signOut();if(error)throw error;status('Tu es déconnecté.');}catch{status('Le planning est masqué. La déconnexion n’a pas pu être confirmée, réessaie.',true);$('logout').hidden=false;}};
try{
  if(!window.supabase?.createClient)throw new Error('La bibliothèque de connexion ne peut pas être chargée. Actualise la page.');
  client=window.supabase.createClient('https://kyzixknnlgdgvxkewmzd.supabase.co','sb_publishable_E8d7sbrlOLOfs3Q9Fn30Uw_X5QqHVuL');
  client.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){clearPrivate();status('Connecte-toi pour consulter le planning.');}
    if(event==='TOKEN_REFRESHED'&&authorized)setTimeout(()=>load(),0);
  });
  await load();
  setInterval(()=>{if(authorized&&!document.hidden)load();},60000);
  document.addEventListener('visibilitychange',()=>{if(authorized&&!document.hidden)load();});
}catch(error){clearPrivate();status(error.message,true);}
