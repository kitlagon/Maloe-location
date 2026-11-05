import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maloe-location.re",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

function validSignature(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 600_000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  const auth = await getAdmin(req);
  if ("error" in auth) return auth.error;
  const admin = auth.admin;

  if (req.method === "GET") {
    const url = new URL(req.url);
    const reservationId = url.searchParams.get("reservation_id") ?? "";
    if (!reservationId) return json({ error: "Réservation manquante." }, 400);
    const { data, error } = await admin.from("etats_des_lieux")
      .select("id,reservation_id,type,date_realisation,observations,signature_client,signature_loueur")
      .eq("reservation_id", reservationId).order("date_realisation", { ascending: true });
    if (error) {
      console.error("EDL records read failed", error.message);
      return json({ error: "Impossible de récupérer les états des lieux." }, 500);
    }
    const { data: pdfRows, error: pdfError } = await admin.from("etat_des_lieux_fichiers")
      .select("etape").eq("reservation_id", reservationId).eq("type_fichier", "pdf");
    if (pdfError) return json({ error: "Impossible de vérifier les PDF du dossier." }, 500);
    const pdfs = { depart: (pdfRows ?? []).some((row) => row.etape === "depart"), retour: (pdfRows ?? []).some((row) => row.etape === "retour") };
    return json({ records: data ?? [], pdfs });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Corps JSON invalide." }, 400); }
  const reservationId = String(body.reservation_id ?? "");
  const stage = String(body.etape ?? "");
  const observations = String(body.observations ?? "").trim();
  const signatureClient = body.signature_client;
  const signatureLoueur = body.signature_loueur;
  if (!reservationId || !["depart", "retour"].includes(stage)) {
    return json({ error: "Réservation ou étape manquante." }, 400);
  }
  if (observations.length > 5000) return json({ error: "Les observations sont limitées à 5 000 caractères." }, 400);
  if (!validSignature(signatureClient) || !validSignature(signatureLoueur)) {
    return json({ error: "Les deux signatures PNG sont obligatoires ou invalides." }, 400);
  }

  const { data: reservation, error: reservationError } = await admin.from("reservations")
    .select("id,retour_effectif_at").eq("id", reservationId).maybeSingle();
  if (reservationError || !reservation) return json({ error: "Réservation introuvable." }, 404);
  if (reservation.retour_effectif_at) return json({ error: "Cette réservation est déjà clôturée." }, 409);
  if (stage === "depart") {
    const { count: idCount, error: idError } = await admin.from("etat_des_lieux_fichiers")
      .select("id", { count: "exact", head: true }).eq("reservation_id", reservationId).eq("type_fichier", "piece_identite");
    if (idError || (idCount ?? 0) < 1) return json({ error: "La copie d'identité filigranée doit être enregistrée avant le départ." }, 409);
    const { count: photoCount, error: photoError } = await admin.from("etat_des_lieux_fichiers")
      .select("id", { count: "exact", head: true }).eq("reservation_id", reservationId).eq("etape", "depart").eq("type_fichier", "photo");
    if (photoError || (photoCount ?? 0) < 1) return json({ error: "Au moins une photo du matériel doit être enregistrée au départ." }, 409);
  }
  if (stage === "retour") {
    const { data: departure, error: departureError } = await admin.from("etats_des_lieux")
      .select("id").eq("reservation_id", reservationId).eq("type", "depart").maybeSingle();
    if (departureError) return json({ error: "Impossible de vérifier l'état des lieux de départ." }, 500);
    if (!departure) return json({ error: "L'état des lieux de départ doit être validé avant le retour." }, 409);
    const { data: departurePdf, error: pdfError } = await admin.from("etat_des_lieux_fichiers")
      .select("id").eq("reservation_id", reservationId).eq("etape", "depart").eq("type_fichier", "pdf").maybeSingle();
    if (pdfError || !departurePdf) return json({ error: "Le PDF de départ doit être enregistré avant le retour." }, 409);
  }

  const { data: existing, error: existingError } = await admin.from("etats_des_lieux")
    .select("id").eq("reservation_id", reservationId).eq("type", stage).maybeSingle();
  if (existingError) return json({ error: "Impossible de vérifier l'étape existante." }, 500);
  if (existing) {
    return json({ id: existing.id, already_saved: true, message: "Cette étape est déjà enregistrée. Elle ne sera pas écrasée." }, 200);
  }

  const { data: record, error: insertError } = await admin.from("etats_des_lieux").insert({
    reservation_id: reservationId,
    type: stage,
    observations,
    signature_client: signatureClient,
    signature_loueur: signatureLoueur,
  }).select("id,date_realisation").single();
  if (insertError) {
    console.error("EDL record insert failed", insertError.message);
    return json({ error: "Impossible d'enregistrer les observations et les signatures." }, 500);
  }
  return json({ id: record.id, date_realisation: record.date_realisation, message: "État des lieux enregistré." }, 201);
});