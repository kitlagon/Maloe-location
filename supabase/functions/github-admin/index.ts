import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://maloe-location.re",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Connexion requise." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const githubToken = Deno.env.get("GITHUB_TOKEN");
    if (!githubToken) return json({ error: "Configuration serveur incomplète." }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: allowed, error: authError } = await userClient.rpc("is_admin");
    if (authError || allowed !== true) return json({ error: "Accès administrateur refusé." }, 403);

    const input = await req.json();
    const path = String(input.path || "");
    const method = String(input.method || "GET").toUpperCase();
    const allowedPath =
      path === "products.json" ||
      path === "images/hero.jpg" ||
      /^images\/kits\/[a-z0-9-]+\.jpg$/i.test(path);

    if (!allowedPath || !["GET", "PUT"].includes(method)) {
      return json({ error: "Opération non autorisée." }, 400);
    }

    const base = "https://api.github.com/repos/kitlagon/Maloe-location/contents/";
    const headers = {
      Authorization: "Bearer " + githubToken,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (method === "GET") {
      const response = await fetch(base + path + "?ref=main", { headers });
      const data = await response.json();
      return json(data, response.status);
    }

    const content = String(input.content || "");
    if (!content || content.length > 9_000_000) return json({ error: "Fichier vide ou trop volumineux." }, 400);

    let sha = input.sha ? String(input.sha) : "";
    if (!sha) {
      const existing = await fetch(base + path + "?ref=main", { headers });
      if (existing.ok) {
        const old = await existing.json();
        sha = old.sha || "";
      } else if (existing.status !== 404) {
        return json({ error: "Impossible de vérifier le fichier GitHub." }, existing.status);
      }
    }

    const payload: Record<string, string> = {
      message: path.startsWith("images/") ? "Mise à jour photo via administration Maloé" : "Mise à jour réglages via administration Maloé",
      content,
      branch: "main",
    };
    if (sha) payload.sha = sha;

    const response = await fetch(base + path, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return json(data, response.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur serveur." }, 500);
  }
});