import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origin = "https://maloe-location.re";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

function clean(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function day(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp : NaN;
}

function time(value: unknown) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

type Product = { id: string; name: string; prices: number[]; pricesTotal?: number[] };
type Promo = { code: string; from: string; to: string; discount: number };

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "Méthode non autorisée." }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 24_000) return reply({ error: "Demande trop volumineuse." }, 413);
    const input = await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null);
    if (!input || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 20 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.id ?? "")) {
      return reply({ error: "Votre panier est invalide." }, 400);
    }

    const name = clean(input.name, 120);
    const email = clean(input.email, 254);
    const phone = clean(input.phone, 25);
    const address = clean(input.address, 300);
    const notes = clean(input.notes, 500);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^[+0-9().\s-]{6,25}$/.test(phone) || phone.replace(/\D/g, "").length < 6 ||
        address.length < 5) {
      return reply({ error: "Vérifiez vos coordonnées et l’adresse de livraison." }, 400);
    }

    const deliveryDay = day(input.retrait);
    const pickupDay = day(input.retour);
    const deliveryTime = time(input.slotRetrait);
    const pickupTime = time(input.slotRetour);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Reunion", dateStyle: "short" }).format(new Date());
    const gap = (pickupDay - deliveryDay) / 86_400_000;
    if (!Number.isFinite(gap) || gap < 0 || input.retrait < today ||
        (gap === 0 && deliveryTime && pickupTime && pickupTime <= deliveryTime)) {
      return reply({ error: "Choisissez des dates et horaires de location valides." }, 400);
    }
    const days = gap === 1 && deliveryTime && deliveryTime >= "17:00" && pickupTime && pickupTime <= "18:00"
      ? 1 : gap + 1;

    const token = clean(input.turnstileToken, 2048);
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!secret) throw new Error("Turnstile secret missing");
    if (!token) return reply({ error: "Effectuez la vérification anti-robot." }, 400);
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!verification.ok) throw new Error("Turnstile verification unavailable");
    const challenge = await verification.json();
    if (challenge.success !== true || challenge.hostname !== "maloe-location.re" || challenge.action !== "delivery_request") {
      return reply({ error: "La vérification anti-robot a expiré ou a échoué. Réessayez." }, 400);
    }

    const catalogResponse = await fetch(origin + "/products.json", { signal: AbortSignal.timeout(8000) });
    if (!catalogResponse.ok) throw new Error("Catalogue unavailable");
    const catalogue = await catalogResponse.json() as { groups: { items: Product[] }[]; promoCodes?: Promo[] };
    const products = new Map(catalogue.groups.flatMap(group => group.items).map(item => [item.id, item]));
    const items = [];
    let totalCents = 0;
    for (const line of input.lines) {
      const product = products.get(line?.id);
      const qty = line?.qty;
      const sizes = line?.sizes ?? {};
      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20 ||
          typeof sizes !== "object" || Array.isArray(sizes) ||
          Object.entries(sizes).some(([family, size]) =>
            !["palmes", "masque-tuba", "easybreath"].includes(family) || !clean(size, 20))) {
        return reply({ error: "Vérifiez les articles, quantités et tailles du panier." }, 400);
      }
      const dailyRate = product.prices[days <= 2 ? 0 : days <= 5 ? 1 : 2];
      const price = product.pricesTotal
        ? product.pricesTotal[Math.min(days, 7) - 1] + Math.max(0, days - 7) * (product.id === "cam360" ? 14 : 15)
        : dailyRate * days;
      if (!Number.isFinite(price) || price < 0) throw new Error("Invalid catalogue price");
      totalCents += Math.round(price * qty * 100);
      items.push({ name: product.name, qty, sizes });
    }

    if (input.promoCode) {
      const promo = catalogue.promoCodes?.find(p => p.code.toUpperCase() === input.promoCode &&
        p.from <= input.retrait && p.to >= input.retrait);
      if (!promo || !Number.isFinite(promo.discount) || promo.discount < 0 || promo.discount > 1) {
        return reply({ error: "Le code promo n’est plus valable. Actualisez votre panier." }, 400);
      }
      totalCents = Math.round(totalCents * (1 - promo.discount));
    }
    if (totalCents < 3000) return reply({ error: "La livraison est proposée dès 30 € de location." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    if (!url || !key) throw new Error("Server configuration missing");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await db.from("delivery_requests").upsert({
      id: input.id, customer_name: name, email, phone, address, notes,
      delivery_date: input.retrait, pickup_date: input.retour, delivery_time: deliveryTime, pickup_time: pickupTime,
      items, rental_total: totalCents / 100,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.error("Delivery request insert failed", error.code);
      throw new Error("Could not save request");
    }

    return reply({ ok: true }, 201);
  } catch (error) {
    console.error("Delivery request failed", error instanceof Error ? error.name : "unknown");
    return reply({ error: "La demande n’a pas pu être envoyée. Réessayez dans un instant." }, 503);
  }
});
