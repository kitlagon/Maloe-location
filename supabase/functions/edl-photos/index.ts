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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

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

  if (req.method === "POST") {
    let form: FormData;
    try { form = await req.formData(); } catch { return json({ error: "Formulaire invalide." }, 400); }
    const reservationId = String(form.get("reservation_id") ?? "");
    const stage = String(form.get("etape") ?? "");
    const itemId = String(form.get("reservation_item_id") ?? "") || null;
    const file = form.get("file");
    if (! reservationId || !["depart", "retour"].includes(stage) || !(file instanceof File)) {
      return json({ error: "Réservation, étape ou photo manquante." }, 400);
    }
    if (!ALLOWED.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
      return json({ error: "Photo refusée : formats JPEG, PNG ou WEBP, 10 Mo maximum." }, 400);
    }

    const { data: reservation, error: reservationError } = await admin
      .from("reservations").select("id").eq("id", reservationId).maybeSingle();
    if (reservationError || !reservation) return json({ error: "Réservation introuvable." }, 404);

    if (!itemId) return json({ error: "Le matériel concerné doit être précisé pour chaque photo." }, 400);
    const { data: item, error: itemError } = await admin.from("reservation_items")
      .select("id").eq("id", itemId).eq("reservation_id", reservationId).maybeSingle();
    if (itemError || !item) return json({ error: "Matériel non rattaché à cette réservation." }, 400);

    const { count: photoCount, error: countError } = await admin.from("etat_des_lieux_fichiers")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", reservationId)
      .eq("reservation_item_id", itemId)
      .eq("etape", stage)
      .eq("type_fichier", "photo");
    if (countError) {
      console.error("EDL photo count failed", countError.message);
      return json({ error: "Impossible de vérifier le nombre de photos." }, 500);
    }
    if ((photoCount ?? 0) >= 3) {
      return json({ error: "Limite atteinte : 3 photos maximum pour ce matériel à cette étape." }, 409);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const path = `${reservationId}/${stage}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await admin.storage.from("etats-des-lieux")
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error("EDL photo upload failed", uploadError.message);
      return json({ error: "Impossible d'enregistrer la photo." }, 500);
    }

    const { data: record, error: insertError } = await admin.from("etat_des_lieux_fichiers").insert({
      reservation_id: reservationId,
      reservation_item_id: itemId,
      etape: stage,
      type_fichier: "photo",
      storage_path: path,
      file_name: file.name.slice(0, 180) || `photo.${extension}`,
      mime_type: file.type,
      size_bytes: file.size,
      sha256,
    }).select("id").single();

    if (insertError) {
      await admin.storage.from("etats-des-lieux").remove([path]);
      console.error("EDL photo metadata insert failed", insertError.message);
      return json({ error: "La photo n'a pas pu être associée à la réservation." }, 500);
    }
    return json({ id: record.id, message: "Photo enregistrée." }, 201);
  }

  const reservationId = new URL(req.url).searchParams.get("reservation_id") ?? "";
  const stage = new URL(req.url).searchParams.get("etape") ?? "";
  if (!reservationId || !["depart", "retour"].includes(stage)) {
    return json({ error: "Réservation ou étape manquante." }, 400);
  }
  const { data: rows, error: listError } = await admin.from("etat_des_lieux_fichiers")
    .select("id, reservation_item_id, file_name, mime_type, created_at, storage_path")
    .eq("reservation_id", reservationId).eq("etape", stage).eq("type_fichier", "photo")
    .order("created_at", { ascending: true });
  if (listError) {
    console.error("EDL photo list failed", listError.message);
    return json({ error: "Impossible de récupérer les photos." }, 500);
  }
  const photos = await Promise.all((rows ?? []).map(async (row) => {
    const { data, error } = await admin.storage.from("etats-des-lieux")
      .createSignedUrl(row.storage_path, 300);
    if (error || !data?.signedUrl) return null;
    return { id: row.id, reservation_item_id: row.reservation_item_id, file_name: row.file_name,
      mime_type: row.mime_type, created_at: row.created_at, url: data.signedUrl };
  }));
  return json({ photos: photos.filter(Boolean) });
});