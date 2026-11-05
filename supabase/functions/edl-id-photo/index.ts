import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maloe-location.re",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

async function getAdmin(req: Request): Promise<{ admin: any } | { error: Response }> {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return { error: json({ error: "Connexion requise." }, 401) };
  let keys: Record<string, string>;
  try { keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); }
  catch { return { error: json({ error: "Configuration serveur invalide." }, 500) }; }
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !keys.default) return { error: json({ error: "Configuration serveur incomplète." }, 500) };
  const admin = createClient(url, keys.default, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.app_metadata?.edl_access !== true) {
    return { error: json({ error: "Compte non autorisé." }, 403) };
  }
  return { admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  const auth = await getAdmin(req);
  if ("error" in auth) return auth.error;
  const admin = auth.admin;

  if (req.method === "GET") {
    const reservationId = new URL(req.url).searchParams.get("reservation_id") ?? "";
    if (!reservationId) return json({ error: "Réservation manquante." }, 400);
    const { data: row, error } = await admin.from("etat_des_lieux_fichiers")
      .select("id,file_name,storage_path,created_at,delete_after")
      .eq("reservation_id", reservationId).eq("type_fichier", "piece_identite").maybeSingle();
    if (error) return json({ error: "Impossible de vérifier la pièce d'identité." }, 500);
    if (!row) return json({ photo: null });
    const { data, error: signedError } = await admin.storage.from("etats-des-lieux")
      .createSignedUrl(row.storage_path, 300);
    if (signedError || !data?.signedUrl) return json({ error: "Impossible de créer le lien privé de consultation." }, 500);
    return json({ photo: { id: row.id, file_name: row.file_name, created_at: row.created_at, delete_after: row.delete_after, url: data.signedUrl } });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "Formulaire invalide." }, 400); }
  const reservationId = String(form.get("reservation_id") ?? "");
  const file = form.get("file");
  if (!reservationId || !(file instanceof File)) return json({ error: "Réservation ou photo manquante." }, 400);
  if (!ALLOWED.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
    return json({ error: "Photo refusée : JPEG, PNG ou WEBP, 10 Mo maximum." }, 400);
  }
  const { data: reservation, error: reservationError } = await admin.from("reservations")
    .select("id,retour_effectif_at").eq("id", reservationId).maybeSingle();
  if (reservationError || !reservation) return json({ error: "Réservation introuvable." }, 404);
  if (reservation.retour_effectif_at) return json({ error: "La réservation est déjà clôturée." }, 409);

  const { data: existing, error: existingError } = await admin.from("etat_des_lieux_fichiers")
    .select("id").eq("reservation_id", reservationId).eq("type_fichier", "piece_identite").maybeSingle();
  if (existingError) return json({ error: "Impossible de vérifier la pièce d'identité existante." }, 500);
  if (existing) return json({ id: existing.id, already_saved: true, message: "Une copie d'identité est déjà enregistrée." }, 200);

  // Le navigateur doit transmettre exclusivement l'image déjà filigranée.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
  const path = `${reservationId}/depart/identite-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage.from("etats-des-lieux")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("EDL identity upload failed", uploadError.message);
    return json({ error: "Impossible d'enregistrer la copie d'identité." }, 500);
  }
  const { data: row, error: insertError } = await admin.from("etat_des_lieux_fichiers").insert({
    reservation_id: reservationId,
    reservation_item_id: null,
    etape: "depart",
    type_fichier: "piece_identite",
    storage_path: path,
    file_name: "piece-identite-filigranee." + extension,
    mime_type: file.type,
    size_bytes: file.size,
    sha256,
  }).select("id").single();
  if (insertError) {
    await admin.storage.from("etats-des-lieux").remove([path]);
    console.error("EDL identity metadata insert failed", insertError.message);
    return json({ error: "La copie d'identité n'a pas pu être associée à la réservation." }, 500);
  }
  return json({ id: row.id, message: "Copie filigranée enregistrée dans le stockage privé." }, 201);
});