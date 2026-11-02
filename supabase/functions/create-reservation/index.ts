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

const allowedSizeFamilies = new Set(["palmes", "masque-tuba", "easybreath"]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    let secretKeys: Record<string, string>;
    try {
      secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    } catch {
      return json({ error: "Configuration serveur invalide." }, 500);
    }
    const serviceRoleKey = secretKeys.default;
    if (!supabaseUrl || typeof serviceRoleKey !== "string" || !serviceRoleKey) {
      return json({ error: "Configuration serveur incomplète." }, 500);
    }

    const rawBody = await req.text();
    if (rawBody.length > 32_000) return json({ error: "Demande trop volumineuse." }, 413);

    let input: any;
    try {
      input = JSON.parse(rawBody);
    } catch {
      return json({ error: "Format de demande invalide." }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json({ error: "Demande invalide." }, 400);
    }

    const { retrait, retour, slotRetrait, slotRetour, lines, client, promoCode, turnstileToken } = input;

    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 20) {
      return json({ error: "Votre panier est vide ou invalide." }, 400);
    }
    if (!validDate(retrait) || !validDate(retour) || retour < retrait) {
      return json({ error: "Dates de location invalides." }, 400);
    }
    if (!validTime(slotRetrait) || !validTime(slotRetour)) {
      return json({ error: "Créneaux horaires invalides." }, 400);
    }
    if (retrait === retour && slotRetour <= slotRetrait) {
      return json({ error: "L'heure de retour doit être après l'heure de retrait." }, 400);
    }

    if (!client || typeof client !== "object" ||
        typeof client.nom !== "string" || typeof client.email !== "string" ||
        typeof client.telephone !== "string") {
      return json({ error: "Coordonnées client manquantes." }, 400);
    }

    const fullName = client.nom.trim().replace(/\s+/g, " ");
    const email = client.email.trim();
    const telephone = client.telephone.trim();
    const splitAt = fullName.lastIndexOf(" ");
    if (fullName.length < 3 || fullName.length > 120 || splitAt < 1 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        !/^[+0-9().\s-]{6,25}$/.test(telephone) ||
        telephone.replace(/\D/g, "").length < 6) {
      return json({ error: "Vérifiez votre prénom, votre nom, votre e-mail et votre téléphone." }, 400);
    }

    const mappedLines = [];
    for (const line of lines) {
      const productId = productIds[String(line?.id ?? "")];
      const qty = Number(line?.qty);
      if (!productId || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return json({ error: "Un article ou une quantité du panier est invalide." }, 400);
      }

      const rawSizes = line?.sizes;
      if (rawSizes !== undefined && (!rawSizes || typeof rawSizes !== "object" || Array.isArray(rawSizes))) {
        return json({ error: "Les tailles sélectionnées sont invalides." }, 400);
      }
      const sizes: Record<string, string> = {};
      for (const [family, size] of Object.entries(rawSizes ?? {})) {
        if (!allowedSizeFamilies.has(family) || typeof size !== "string" || size.length > 20) {
          return json({ error: "Les tailles sélectionnées sont invalides." }, 400);
        }
        sizes[family] = size;
      }
      mappedLines.push({ product_id: productId, qty, sizes });
    }

    // Vérification obligatoire du jeton Turnstile côté serveur.
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) {
      return json({ error: "La vérification anti-robot est momentanément indisponible." }, 503);
    }
    if (typeof turnstileToken !== "string" || turnstileToken.length < 1 || turnstileToken.length > 2048) {
      return json({ error: "Veuillez effectuer la vérification anti-robot." }, 400);
    }

    let turnstileResult: any;
    try {
      const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: turnstileToken,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!verifyResponse.ok) throw new Error("Turnstile verification request failed");
      turnstileResult = await verifyResponse.json();
    } catch {
      return json({ error: "La vérification anti-robot a échoué. Réessayez." }, 503);
    }

    if (turnstileResult?.success !== true || turnstileResult?.hostname !== "maloe-location.re") {
      return json({ error: "La vérification anti-robot est invalide ou a expiré. Réessayez." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("create_reservation_atomic", {
      p_client: {
        prenom: fullName.slice(0, splitAt).trim(),
        nom: fullName.slice(splitAt + 1).trim(),
        email,
        telephone,
      },
      p_date_retrait: retrait,
      p_date_retour: retour,
      p_heure_retrait: slotRetrait,
      p_heure_retour: slotRetour,
      p_lines: mappedLines,
      p_promo_code: typeof promoCode === "string" ? promoCode.trim() : null,
    });

    if (error) {
      const knownConflict = /stock insuffisant|indisponible|taille|dates|créneaux|panier|code promotionnel/i.test(error.message || "");
      return json({
        error: knownConflict
          ? "La réservation ne peut pas être créée avec ces dates, tailles ou disponibilités. Vérifiez votre panier."
          : "Une erreur empêche la création de la réservation. Réessayez plus tard.",
      }, knownConflict ? 409 : 400);
    }

    return json({ success: true, reservation: data }, 201);
  } catch {
    return json({ error: "Erreur serveur. Réessayez plus tard." }, 500);
  }
});
