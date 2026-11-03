import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maloe-location.re",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Méthode non autorisée." }, 405);

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
    return json({ error: "Compte non autorisé à consulter les réservations." }, 403);
  }

  const { data, error } = await admin
    .from("reservations")
    .select(`
      id, date_retrait, date_retour, heure_retrait, heure_retour, statut,
      client:clients ( id, nom, prenom, telephone, email ),
      items:reservation_items (
        id, quantite, details,
        produit:produits ( id, nom, description )
      )
    `)
    .order("date_retrait", { ascending: true })
    .limit(200);

  if (error) {
    console.error("EDL reservations query failed", { code: error.code, message: error.message });
    return json({ error: "Impossible de charger les réservations." }, 500);
  }

  return json({
    reservations: (data ?? []).map((r: any) => ({
      id: r.id,
      date_retrait: r.date_retrait,
      date_retour: r.date_retour,
      heure_retrait: r.heure_retrait,
      heure_retour: r.heure_retour,
      statut: r.statut,
      client: Array.isArray(r.client) ? r.client[0] : r.client,
      items: (r.items ?? []).map((item: any) => ({
        id: item.id,
        quantite: item.quantite,
        details: item.details,
        produit: Array.isArray(item.produit) ? item.produit[0] : item.produit,
      })),
    })),
  });
});
