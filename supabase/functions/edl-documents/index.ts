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

  let secretKeys: Record<string, string>;
  try {
    secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  } catch {
    return json({ error: "Configuration serveur invalide." }, 500);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = secretKeys.default;
  if (!url || !serviceKey) return json({ error: "Configuration serveur incomplète." }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user || user.app_metadata?.edl_access !== true) {
    return json({ error: "Compte non autorisé." }, 403);
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "Formulaire invalide." }, 400); }
  const reservationId = String(form.get("reservation_id") ?? "");
  const stage = String(form.get("etape") ?? "");
  const file = form.get("file");
  if (!reservationId || !["depart", "retour"].includes(stage) || !(file instanceof File)) {
    return json({ error: "Réservation, étape ou PDF manquant." }, 400);
  }
  if (file.type !== "application/pdf" || file.size <= 0 || file.size > MAX_BYTES) {
    return json({ error: "PDF refusé : format PDF uniquement, 10 Mo maximum." }, 400);
  }

  const { data: reservation, error: reservationError } = await admin
    .from("reservations").select("id").eq("id", reservationId).maybeSingle();
  if (reservationError || !reservation) return json({ error: "Réservation introuvable." }, 404);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return json({ error: "Le fichier transmis n'est pas un PDF valide." }, 400);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${reservationId}/${stage}/${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await admin.storage.from("etats-des-lieux")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    console.error("EDL PDF upload failed", uploadError.message);
    return json({ error: "Impossible d'enregistrer le PDF dans le stockage privé." }, 500);
  }

  const { data: record, error: insertError } = await admin.from("etat_des_lieux_fichiers").insert({
    reservation_id: reservationId,
    reservation_item_id: null,
    etape: stage,
    type_fichier: "pdf",
    storage_path: path,
    file_name: file.name.slice(0, 180) || `etat-des-lieux-${stage}.pdf`,
    mime_type: "application/pdf",
    size_bytes: file.size,
    sha256,
  }).select("id").single();

  if (insertError) {
    await admin.storage.from("etats-des-lieux").remove([path]);
    console.error("EDL PDF metadata insert failed", insertError.message);
    return json({ error: "Le PDF n'a pas pu être associé à la réservation. Vérifie qu'un PDF de cette étape n'existe pas déjà." }, 409);
  }
  return json({ id: record.id, message: "PDF enregistré dans le stockage privé." }, 201);
});
