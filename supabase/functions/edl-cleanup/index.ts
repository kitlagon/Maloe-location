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

  // 1) Supprimer d'abord les objets Storage arrivés à échéance.
  // Les références en base ne sont supprimées qu'après succès du Storage.
  const { data: files, error: selectError } = await supabase
    .from("etat_des_lieux_fichiers")
    .select("id, storage_path")
    .not("delete_after", "is", null)
    .lte("delete_after", new Date().toISOString())
    .order("delete_after", { ascending: true })
    .limit(100);

  if (selectError) {
    console.error("EDL cleanup file selection failed", selectError.message);
    return json({ error: "Impossible de rechercher les fichiers expirés." }, 500);
  }

  let deletedFiles = 0;
  if (files?.length) {
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
    deletedFiles = files.length;
  }

  // 2) Supprimer aussi observations et signatures après 14 jours.
  // La réservation et la fiche client ne sont jamais supprimées.
  // On ne retire les constats que lorsqu'il ne reste plus aucun fichier
  // associé à la réservation (les fichiers sont traités par lots de 100).
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiredRecords, error: reservationsError } = await supabase
    .from("etats_des_lieux")
    .select("reservation_id, reservations!inner(retour_effectif_at)")
    .not("reservations.retour_effectif_at", "is", null)
    .lte("reservations.retour_effectif_at", cutoff)
    .limit(100);

  if (reservationsError) {
    console.error("EDL cleanup expired-record selection failed", reservationsError.message);
    return json({ error: "Impossible de rechercher les dossiers EDL expirés.", deletedFiles }, 500);
  }

  const expiredReservationIds = [...new Set(
    (expiredRecords ?? []).map((record) => record.reservation_id),
  )];

  let deletedRecords = 0;
  for (const reservationId of expiredReservationIds) {
    const { data: remainingFiles, error: remainingError } = await supabase
      .from("etat_des_lieux_fichiers")
      .select("id")
      .eq("reservation_id", reservationId)
      .limit(1);

    if (remainingError) {
      console.error("EDL cleanup remaining-file check failed", remainingError.message);
      return json({ error: "Impossible de vérifier les fichiers restants.", deletedFiles, deletedRecords }, 500);
    }

    if (remainingFiles?.length) continue;

    const { data: removedRecords, error: recordsError } = await supabase
      .from("etats_des_lieux")
      .delete()
      .eq("reservation_id", reservationId)
      .select("id");

    if (recordsError) {
      console.error("EDL cleanup record deletion failed", recordsError.message);
      return json({ error: "Impossible de supprimer les observations et signatures expirées.", deletedFiles, deletedRecords }, 500);
    }
    deletedRecords += removedRecords?.length ?? 0;
  }

  return json({
    success: true,
    deletedFiles,
    deletedRecords,
    checkedReservations: expiredReservationIds.length,
  });
});
