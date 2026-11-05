import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maloe-location.re",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ error: "Connexion requise." }, 401);
  let keys: Record<string, string>;
  try { keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); }
  catch { return json({ error: "Configuration serveur invalide." }, 500); }
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !keys.default) return json({ error: "Configuration serveur incomplète." }, 500);
  const admin = createClient(url, keys.default, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || user.app_metadata?.edl_access !== true) return json({ error: "Compte non autorisé." }, 403);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "Formulaire invalide." }, 400); }
  const reservationId = String(form.get("reservation_id") ?? "");
  const stage = String(form.get("etape") ?? "");
  const file = form.get("file");
  if (!reservationId || !["depart", "retour"].includes(stage) || !(file instanceof File)) {
    return json({ error: "Réservation, étape ou PDF manquant." }, 400);
  }
  if (file.type !== "application/pdf" || file.size <= 0 || file.size > MAX_BYTES) {
    return json({ error: "PDF refusé : PDF uniquement, 10 Mo maximum." }, 400);
  }
  const { data: reservation, error: reservationError } = await admin.from("reservations")
    .select("id").eq("id", reservationId).maybeSingle();
  if (reservationError || !reservation) return json({ error: "Réservation introuvable." }, 404);

  const { data: record, error: recordError } = await admin.from("etats_des_lieux")
    .select("id").eq("reservation_id", reservationId).eq("type", stage).maybeSingle();
  if (recordError) return json({ error: "Impossible de vérifier l'état des lieux enregistré." }, 500);
  if (!record) return json({ error: "Les observations et les deux signatures doivent être enregistrées avant le PDF." }, 409);
  if (stage === "retour") {
    const { data: departure, error: departureError } = await admin.from("etats_des_lieux")
      .select("id").eq("reservation_id", reservationId).eq("type", "depart").maybeSingle();
    if (departureError || !departure) return json({ error: "L'état des lieux de départ est manquant." }, 409);
    const { data: departurePdf, error: pdfError } = await admin.from("etat_des_lieux_fichiers")
      .select("id").eq("reservation_id", reservationId).eq("etape", "depart").eq("type_fichier", "pdf").maybeSingle();
    if (pdfError || !departurePdf) return json({ error: "Le PDF de départ doit être enregistré avant le PDF de retour." }, 409);
  }

  const { data: existing, error: existingError } = await admin.from("etat_des_lieux_fichiers")
    .select("id").eq("reservation_id", reservationId).eq("etape", stage).eq("type_fichier", "pdf").maybeSingle();
  if (existingError) return json({ error: "Impossible de vérifier le PDF existant." }, 500);
  if (existing) {
    if (stage === "retour") {
      const { error: closeError } = await admin.rpc("cloturer_retour_etat_des_lieux", { p_reservation_id: reservationId });
      if (closeError) return json({ error: "Le PDF existe mais la clôture du retour a échoué." }, 500);
    }
    return json({ id: existing.id, already_saved: true, message: "Le PDF de cette étape est déjà enregistré." });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return json({ error: "Le fichier transmis n'est pas un PDF valide." }, 400);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${reservationId}/${stage}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await admin.storage.from("etats-des-lieux")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    console.error("EDL PDF upload failed", uploadError.message);
    return json({ error: "Impossible d'enregistrer le PDF dans le stockage privé." }, 500);
  }
  const { data: inserted, error: insertError } = await admin.from("etat_des_lieux_fichiers").insert({
    reservation_id: reservationId, reservation_item_id: null, etape: stage, type_fichier: "pdf",
    storage_path: path, file_name: file.name.slice(0, 180) || `etat-des-lieux-${stage}.pdf`,
    mime_type: "application/pdf", size_bytes: file.size, sha256,
  }).select("id").single();
  if (insertError) {
    await admin.storage.from("etats-des-lieux").remove([path]);
    console.error("EDL PDF metadata insert failed", insertError.message);
    return json({ error: "Le PDF n'a pas pu être associé à la réservation." }, 409);
  }
  if (stage === "retour") {
    const { error: closeError } = await admin.rpc("cloturer_retour_etat_des_lieux", { p_reservation_id: reservationId });
    if (closeError) {
      await admin.from("etat_des_lieux_fichiers").delete().eq("id", inserted.id);
      await admin.storage.from("etats-des-lieux").remove([path]);
      console.error("EDL return closure failed", closeError.message);
      return json({ error: "Le PDF a été annulé car la clôture du retour n'a pas pu être enregistrée." }, 500);
    }
  }
  return json({ id: inserted.id, message: "PDF enregistré dans le stockage privé." }, 201);
});