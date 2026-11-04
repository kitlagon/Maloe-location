import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const cronSecret = Deno.env.get("EDL_CLEANUP_SECRET");
  const suppliedSecret = req.headers.get("x-edl-cleanup-secret");
  if (!cronSecret || !suppliedSecret || suppliedSecret !== cronSecret) {
    return json({ error: "Accès non autorisé." }, 401);
  }

  let secretKeys: Record<string, string>;
  try {
    secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  } catch {
    return json({ error: "Configuration serveur invalide." }, 500);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = secretKeys.default;
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Configuration Supabase incomplète." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Petits lots pour limiter la durée d'exécution. Les lignes ne sont
  // supprimées qu'après confirmation de la suppression des objets Storage.
  const { data: files, error: selectError } = await supabase
    .from("etat_des_lieux_fichiers")
    .select("id, storage_path")
    .not("delete_after", "is", null)
    .lte("delete_after", new Date().toISOString())
    .order("delete_after", { ascending: true })
    .limit(100);

  if (selectError) {
    console.error("EDL cleanup select failed", selectError.message);
    return json({ error: "Impossible de rechercher les fichiers expirés." }, 500);
  }
  if (!files?.length) return json({ success: true, deleted: 0 });

  const paths = files.map((file) => file.storage_path);
  const { error: storageError } = await supabase.storage
    .from("etats-des-lieux")
    .remove(paths);

  if (storageError) {
    console.error("EDL cleanup storage removal failed", storageError.message);
    return json({ error: "La suppression du stockage a échoué; les références sont conservées." }, 500);
  }

  const ids = files.map((file) => file.id);
  const { error: deleteError } = await supabase
    .from("etat_des_lieux_fichiers")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("EDL cleanup metadata deletion failed", deleteError.message);
    return json({ error: "Les fichiers sont supprimés, mais les références restent à nettoyer." }, 500);
  }

  return json({ success: true, deleted: files.length });
});
