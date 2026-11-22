import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { sendDeliveryEmail } from "./delivery-email.ts";

const reply=(v:unknown,s=200)=>Response.json(v,{status:s});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"Method"},405);
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const key=keys.default;
 if(!key)return reply({error:"Server config"},500);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false}});
 const {data:secrets,error:secretError}=await db.rpc("admin_push_secrets");
 if(secretError||!secrets)return reply({error:"Secrets unavailable"},500);
 if(req.headers.get("x-maloe-push-secret")!==secrets.maloe_push_cron_secret)return reply({error:"Unauthorized"},401);
 webpush.setVapidDetails("mailto:contact@maloe-location.re","BEIpS9MQXtopL62RYYE-gLnBBBh4kRTCfhaljbg-j2ZIX29lWPtPbTxtEkimfpfAHJZC1NHp4BK2fCJzxcyaGLc",secrets.maloe_push_vapid_private);
 const payload=await req.json().catch(()=>({}));
 const templates={
  paid:{title:"TEST — Réservation payée",body:"Réservation fictive : paiement confirmé"},
  cancelled:{title:"TEST — Annulation",body:"Annulation fictive : aucun client réel"},
  return:{title:"TEST — Retour dans 30 minutes",body:"Rappel fictif : matériel à récupérer"}
 };
 const template=templates[payload.kind]||{title:"Maloé Gestion — Test automatique",body:"Test envoyé depuis Supabase"};

 if(payload.test===true){
  const {data:subs,error}=await db.from("admin_push_subscriptions").select("id,endpoint,p256dh,auth_secret");
  if(error)return reply({error:"Subscriptions query"},500);
  const results=[];
  for(const sub of subs||[]){
   try{const res=await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},JSON.stringify({title:template.title,body:template.body,tag:"maloe-test-automatic-"+Date.now()}),{TTL:600});results.push({status:res.statusCode})}
   catch(e){results.push({error:String((e as Error).message).slice(0,150),status:(e as any).statusCode||null})}
  }
  return reply({ok:true,test:true,subscriptions:(subs||[]).length,results});
 }
 const now=new Date();
 const horizon=new Date(now.getTime()+31*60000);
 const {data:returns,error:retError}=await db.from("reservations").select("id,date_retour,heure_retour,statut,mode_test,retour_effectif_at").eq("mode_test",false).eq("statut","confirmee").is("retour_effectif_at",null).gte("date_retour",now.toLocaleDateString("en-CA",{timeZone:"Indian/Reunion"})).lte("date_retour",horizon.toLocaleDateString("en-CA",{timeZone:"Indian/Reunion"}));
 if(retError)return reply({error:"Returns query"},500);
 const localParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Indian/Reunion",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
 for(const r of returns||[]){
  const due=new Date(r.date_retour+"T"+String(r.heure_retour).slice(0,5)+":00+04:00").getTime()-30*60000;
  if(due<=now.getTime()&&due>now.getTime()-120000){
   await db.from("admin_push_events").upsert({reservation_id:r.id,kind:"return",due_at:new Date(due).toISOString()},{onConflict:"reservation_id,kind",ignoreDuplicates:true});
  }
 }
 const {data:events,error:eventError}=await db.from("admin_push_events").select("id,reservation_id,delivery_request_id,kind,attempts").is("sent_at",null).lte("due_at",now.toISOString()).lt("attempts",5).order("id").limit(30);
 if(eventError)return reply({error:"Events query"},500);
 const {data:subs,error:subsError}=await db.from("admin_push_subscriptions").select("id,endpoint,p256dh,auth_secret");
 if(subsError)return reply({error:"Subscriptions query"},500);
 let sent=0,failed=0;
 for(const event of events||[]){
  let title: string, body: string;
  if (event.kind === "delivery") {
   title = "Nouvelle demande de livraison";
   body = "Consultez la demande dans Maloé Gestion.";
  } else {
   const {data:r}=await db.from("reservations").select("id,date_retrait,date_retour,heure_retour,total,statut,client:clients(nom,prenom),reservation_items(quantite,produit:produits(nom))").eq("id",event.reservation_id).maybeSingle();
   if(!r){await db.from("admin_push_events").update({sent_at:new Date().toISOString()}).eq("id",event.id);continue}
   const client=Array.isArray(r.client)?r.client[0]:r.client;
   const name=[client?.prenom,client?.nom].filter(Boolean).join(" ");
   const materials=(r.reservation_items||[]).map((x:any)=>x.quantite+" × "+(Array.isArray(x.produit)?x.produit[0]?.nom:x.produit?.nom||"matériel")).join(", ");
   title = event.kind==="paid"?"Nouvelle réservation payée":event.kind==="cancelled"?"Réservation annulée":"Retour dans 30 minutes";
   body = (name?name+" · ":"")+(materials||"Matériel")+" · "+(event.kind==="return"?"retour "+String(r.heure_retour).slice(0,5):event.kind==="paid"?Number(r.total).toFixed(2)+" €":"réservation annulée");
  }
  const target = event.kind === "delivery" ? event.delivery_request_id : event.reservation_id;
  let ok=0,errors=[];
  for(const sub of subs||[]){
   try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},JSON.stringify({title,body,view:event.kind==="delivery"?"livraisons":undefined,tag:"maloe-"+event.kind+"-"+target}),{TTL:3600});ok++;sent++}
   catch(e){const status=(e as any)?.statusCode;if(status===404||status===410)await db.from("admin_push_subscriptions").delete().eq("id",sub.id);else errors.push(String((e as Error).message).slice(0,180));failed++}
  }
  if((subs||[]).length===0||errors.length){await db.from("admin_push_events").update({attempts:event.attempts+1,last_error:errors.join("; ")||"No subscribed devices"}).eq("id",event.id)}
  else await db.from("admin_push_events").update({sent_at:new Date().toISOString(),attempts:event.attempts+1,last_error:null}).eq("id",event.id);
 }

 const {data:deliveryEmails,error:deliveryEmailError}=await db.from("delivery_requests")
  .select("id,customer_name,email,phone,address,notes,delivery_date,pickup_date,delivery_time,pickup_time,items,rental_total,email_attempts")
  .is("email_sent_at",null).lt("email_attempts",5).lte("email_next_attempt_at",now.toISOString())
  .order("email_next_attempt_at").limit(3);
 if(deliveryEmailError)return reply({error:"Delivery email queue query"},500);
 let deliveryEmailsSent=0;
 for(const request of deliveryEmails||[]){
  const retryAt=new Date(Date.now()+5*60_000).toISOString();
  const {data:claim,error:claimError}=await db.from("delivery_requests")
   .update({email_attempts:request.email_attempts+1,email_next_attempt_at:retryAt})
   .eq("id",request.id).eq("email_attempts",request.email_attempts)
   .is("email_sent_at",null).select("id").maybeSingle();
  if(claimError){console.error("Delivery email claim failed",claimError.code);continue}
  if(!claim)continue;
  try{
   await sendDeliveryEmail(request);
   const {error:recordError}=await db.from("delivery_requests")
    .update({email_sent_at:new Date().toISOString(),email_next_attempt_at:null}).eq("id",request.id);
   if(recordError)console.error("Delivery email status update failed",recordError.code);
   else deliveryEmailsSent++;
  }catch(error){
   console.error("Delivery email failed",error instanceof Error?error.message:"SMTP error");
  }
 }
 return reply({ok:true,events:(events||[]).length,subscriptions:(subs||[]).length,sent,failed,deliveryEmailsSent});
});
