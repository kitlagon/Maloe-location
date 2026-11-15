import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
const reply=(v:unknown,status=200)=>Response.json(v,{status});
const escape=(v:unknown)=>String(v??"").replace(/[\r\n]/g," ").trim();
const validEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const encode=(v:string)=>btoa(Array.from(new TextEncoder().encode(v),b=>String.fromCharCode(b)).join(""));
const htmlSafe=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const pickupLocation="Rue des Maldives, à proximité du centre équestre, à l’Ermitage-les-Bains";
const signatureHtml='<div style="margin-top:24px;padding-top:14px;border-top:1px solid #dce8ef"><a href="https://maloe-location.re/" style="text-decoration:none"><img src="https://maloe-location.re/images/logo.jpg" alt="Maloé Location" width="130" style="width:130px;max-width:100%;height:auto;border:0;display:block"></a></div>';
const toHtml=(body:string)=>{
 const lines=body.split("\n");
 const sections=lines.map(line=>{
  const safe=htmlSafe(line);
  if(!line.trim())return '<div style="height:13px"></div>';
  if(/^(Référence|Retrait|Retour|Montant payé|Montant encaissé|Caution prévue|Lieu de retrait et de retour|Client|Email|Téléphone)\s*:/.test(line)){
   const p=safe.indexOf(":");return '<div style="padding:6px 0;border-bottom:1px solid #e7eff4"><strong style="color:#155b87">'+safe.slice(0,p+1)+'</strong>'+safe.slice(p+1)+'</div>';
  }
  if(line==="Matériel :")return '<div style="font-weight:bold;color:#155b87;margin-top:12px">Matériel réservé</div>';
  if(line.startsWith("- "))return '<div style="padding:5px 12px;background:#f3f8fb;border-radius:5px">'+safe+'</div>';
  return '<div>'+safe+'</div>';
 }).join("");
 return '<!doctype html><html><body style="margin:0;padding:20px 12px;background:#f4f9fc;font-family:Arial,Helvetica,sans-serif;color:#17374c;font-size:15px;line-height:1.65"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #dce9f2;border-radius:12px;overflow:hidden"><div style="background:#12618d;color:#fff;padding:19px 24px;font-size:21px;font-weight:bold">Maloé Location</div><div style="padding:24px">'+sections+signatureHtml+'</div><div style="background:#edf5fa;padding:13px 24px;color:#42677e;font-size:12px">Maloé Location · Plage de l’Ermitage · La Réunion</div></div></body></html>';
};
async function sendMail(to:string,subject:string,body:string){
 const host=Deno.env.get("SMTP_HOST"),port=Number(Deno.env.get("SMTP_PORT")||465),user=Deno.env.get("SMTP_USER"),password=Deno.env.get("SMTP_PASSWORD"),from=Deno.env.get("SMTP_FROM");
 if(!host||!user||!password||!from)throw Error("SMTP settings missing");
 if(!validEmail(to)||!validEmail(from))throw Error("Invalid email address");
 let conn:Deno.TlsConn|undefined;
 try{
  conn=await Deno.connectTls({hostname:host,port});
  const decoder=new TextDecoder(),encoder=new TextEncoder();let buffer="";
  const line=async()=>{while(!buffer.includes("\r\n")){const bytes=new Uint8Array(4096);const n=await conn!.read(bytes);if(n===null)throw Error("SMTP disconnected");buffer+=decoder.decode(bytes.subarray(0,n));if(buffer.length>64000)throw Error("SMTP response too long");}const p=buffer.indexOf("\r\n");const out=buffer.slice(0,p);buffer=buffer.slice(p+2);return out;};
  const response=async()=>{let v=await line();const code=v.slice(0,3);while(v[3]==="-"){v=await line();if(v.slice(0,3)!==code)throw Error("SMTP malformed reply");}return Number(code);};
  const command=async(s:string,codes:number[])=>{await conn!.write(encoder.encode(s+"\r\n"));const code=await response();if(!codes.includes(code))throw Error("SMTP returned "+code);};
  if(await response()!==220)throw Error("SMTP banner failed");
  await command("EHLO maloe-location.re",[250]);await command("AUTH LOGIN",[334]);await command(encode(user),[334]);await command(encode(password),[235]);
  await command("MAIL FROM:<"+from+">",[250]);await command("RCPT TO:<"+to+">",[250,251]);await command("DATA",[354]);
  const boundary="maloe_"+crypto.randomUUID().replace(/-/g,"");
  const wrap=(s:string)=>encode(s).match(/.{1,76}/g)!.join("\r\n");
  const message=["From: =?UTF-8?B?"+encode("Maloé Location")+"?= <"+from+">","To: <"+to+">","Subject: =?UTF-8?B?"+encode(subject)+"?=","MIME-Version: 1.0",'Content-Type: multipart/alternative; boundary="'+boundary+'"',"","--"+boundary,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",wrap(body),"--"+boundary,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: base64","",wrap(toHtml(body)),"--"+boundary+"--","."].join("\r\n")+"\r\n";
  await conn.write(encoder.encode(message));if(await response()!==250)throw Error("SMTP message not accepted");
  try{await command("QUIT",[221]);}catch{}
 }finally{try{conn?.close();}catch{}}
}
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const secret=keys.default;
 if(!secret||req.headers.get("Authorization")!=="Bearer "+secret)return reply({error:"Forbidden"},403);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,secret,{auth:{persistSession:false}});
 const input=await req.json().catch(()=>({}));
 if(input.action!=="preview"&&input.action!=="send")return reply({error:"Invalid action"},400);
 if(typeof input.reservation_id!=="string"||!/^[a-f0-9-]{36}$/i.test(input.reservation_id))return reply({error:"Invalid reservation"},400);
 const {data:r,error:err}=await db.from("reservations").select("id,client_id,date_retrait,date_retour,heure_retrait,heure_retour,total,caution,statut,stancer_payment_status").eq("id",input.reservation_id).maybeSingle();
 if(err||!r)return reply({error:"Reservation not found"},404);
 if(r.statut!=="confirmee"||r.stancer_payment_status!=="captured")return reply({error:"Reservation not paid"},409);
 const [{data:client},{data:items},{data:notifications}]=await Promise.all([
 db.from("clients").select("nom,prenom,email,telephone").eq("id",r.client_id).maybeSingle(),
 db.from("reservation_items").select("produit_id,quantite,details").eq("reservation_id",r.id),
 db.from("reservation_email_notifications").select("id,recipient_type,status,attempts").eq("reservation_id",r.id)]);
 if(!client||!items||!notifications)return reply({error:"Incomplete reservation"},500);
 const ids=items.map((i:any)=>i.produit_id);
 const {data:products}=await db.from("produits").select("id,nom").in("id",ids);
 const names=new Map((products||[]).map((p:any)=>[p.id,p.nom]));
 const material=items.map((i:any)=>"- "+escape(names.get(i.produit_id)||"Article")+" × "+i.quantite).join("\n");
 const dateFr=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.slice(8,10)+"/"+value.slice(5,7)+"/"+value.slice(0,4):value;
 const timeFr=(value:string)=>String(value||"").slice(0,5).replace(":","h");
 const dates="Retrait : "+dateFr(r.date_retrait)+" à "+timeFr(r.heure_retrait)+"\nRetour : "+dateFr(r.date_retour)+" à "+timeFr(r.heure_retour);
 const meeting="\nLieu de retrait et de retour : "+pickupLocation+"\nSur rendez-vous, aux créneaux convenus. Le point de rendez-vous précis vous sera communiqué après réservation.";
 const ref=r.id.slice(0,8).toUpperCase();
 const customerName=[client.prenom,client.nom].filter(Boolean).map(escape).join(" ");
 const customerBody="Bonjour "+customerName+",\n\nVotre réservation Maloé Location est confirmée et votre paiement a été encaissé.\n\nRéférence : "+ref+"\n"+dates+meeting+"\n\nMatériel :\n"+material+"\n\nMontant payé : "+Number(r.total).toFixed(2)+" €\nCaution prévue : "+Number(r.caution||0).toFixed(2)+" €\n\nPour toute question : contact@maloe-location.re\n\nÀ bientôt,\nMaloé Location";
 const managerBody="Nouvelle réservation payée Maloé Location\n\nRéférence : "+ref+"\nClient : "+customerName+"\nEmail : "+escape(client.email)+"\nTéléphone : "+escape(client.telephone)+"\n"+dates+meeting+"\n\nMatériel :\n"+material+"\n\nMontant encaissé : "+Number(r.total).toFixed(2)+" €\nCaution prévue : "+Number(r.caution||0).toFixed(2)+" €";
 const messages=[{type:"client",to:escape(client.email),subject:"Confirmation de réservation Maloé Location - "+ref,body:customerBody},{type:"gestionnaire",to:"contact@maloe-location.re",subject:"Nouvelle réservation payée - "+ref,body:managerBody}];
 if(input.action==="preview")return reply({ok:true,reference:ref,notifications:messages.map(m=>({recipient_type:m.type,to:m.to,status:notifications.find((n:any)=>n.recipient_type===m.type)?.status||"not_queued"})),material_count:items.length});
 const outcomes=[];
 for(const m of messages){
  const n=notifications.find((x:any)=>x.recipient_type===m.type);
  if(!n||n.status==="sent"){outcomes.push({type:m.type,status:n?.status||"not_queued"});continue;}
  if(n.status==="sending"){outcomes.push({type:m.type,status:"sending"});continue;}
  const {data:claimed}=await db.from("reservation_email_notifications").update({status:"sending",attempts:n.attempts+1,updated_at:new Date().toISOString()}).eq("id",n.id).in("status",["pending","failed"]).select("id").maybeSingle();
  if(!claimed){outcomes.push({type:m.type,status:"not_claimed"});continue;}
  try{
   await sendMail(m.to,m.subject,m.body);
   await db.from("reservation_email_notifications").update({status:"sent",sent_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("id",n.id);
   outcomes.push({type:m.type,status:"sent"});
  }catch(e){
   const error=e instanceof Error?e.message:"Unknown SMTP error";
   console.error("Reservation email failed",m.type,error);
   await db.from("reservation_email_notifications").update({status:"failed",last_error:error.slice(0,200),updated_at:new Date().toISOString()}).eq("id",n.id);
   outcomes.push({type:m.type,status:"failed"});
  }
 }
 return reply({ok:outcomes.every(x=>x.status==="sent"),outcomes});
});
