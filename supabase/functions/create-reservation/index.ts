import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maloe-location.re",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const productIds: Record<string, string> = {
  cam360: "dd57ed07-e79a-4dfa-a1a7-7713bc706583",
  glaciere: "4f5925d5-c2e0-44d7-a109-717eb9b252cb",
  pmt: "2bb17b1f-95e0-4bc4-ad73-b95b0e1fc175",
  "pmt-cam": "5e134175-d5d7-491a-b637-03482ba33383",
  "masque-tuba": "65ff494c-a5f7-43ff-9fb1-27d587b1a8ae",
  easybreath: "1b1dfa4d-13b0-4463-8005-f1ec0aea0fe6",
  "easy-cam": "2cdea375-f36e-4b02-ba7f-5aec0e7be00a",
  "palme-easy": "ff8eca8f-a133-4302-b273-0717345dff8f",
  palmes: "20e39c46-7acd-4553-827d-625c1c022b10",
  parasol: "9bcf2e83-62f6-422b-9bf4-69fc455fbe32",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Configuration serveur incomplète." }, 500);
    }

    const input = await req.json();
    const { retrait, retour, slotRetrait, slotRetour, lines, client, promoCode } = input ?? {};

    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 20) {
      return json({ error: "Votre panier est vide ou invalide." }, 400);
    }
    if (typeof retrait !== "string" || typeof retour !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(retrait) || !/^\d{4}-\d{2}-\d{2}$/.test(retour)) {
      return json({ error: "Dates invalides." }, 400);
    }
    if (typeof client?.nom !== "string" || typeof client?.email !== "string" ||
        typeof client?.telephone !== "string") {
      return json({ error: "Coordonnées client manquantes." }, 400);
    }

    const fullName = client.nom.trim().replace(/\s+/g, " ");
    const splitAt = fullName.lastIndexOf(" ");
    if (splitAt < 1 || !client.email.trim() || !client.telephone.trim()) {
      return json({ error: "Indiquez votre prénom, votre nom, votre e-mail et votre téléphone." }, 400);
    }

    const mappedLines = lines.map((line: any) => {
      const productId = productIds[String(line?.id ?? "")];
      const qty = Number(line?.qty);
      if (!productId || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        throw new Error("Un article ou une quantité du panier est invalide.");
      }
      const sizes = line?.sizes && typeof line.sizes === "object" && !Array.isArray(line.sizes)
        ? line.sizes : {};
      return { product_id: productId, qty, sizes };
    });

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("create_reservation_atomic", {
      p_client: {
        prenom: fullName.slice(0, splitAt).trim(),
        nom: fullName.slice(splitAt + 1).trim(),
        email: client.email.trim(),
        telephone: client.telephone.trim(),
      },
      p_date_retrait: retrait,
      p_date_retour: retour,
      p_heure_retrait: slotRetrait,
      p_heure_retour: slotRetour,
      p_lines: mappedLines,
      p_promo_code: typeof promoCode === "string" ? promoCode.trim() : null,
    });

    if (error) {
      const message = error.message || "Impossible de créer la réservation.";
      const status = /stock insuffisant|indisponible|taille|dates|créneaux|panier|code promotionnel/i.test(message) ? 409 : 400;
      return json({ error: message }, status);
    }

    return json({ success: true, reservation: data }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur serveur." }, 400);
  }
});
