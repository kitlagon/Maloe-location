# Mise en place du nettoyage automatique des états des lieux

Cette procédure concerne uniquement la branche `feature/edl-double-signature`. Elle n'a pas été exécutée sur le projet Supabase de production.

## Prérequis

1. Déployer la fonction Edge `edl-cleanup` après validation du code.
2. Appliquer les migrations EDL dans l'ordre.
3. Dans Supabase, vérifier que les extensions `pg_cron`, `pg_net` et `supabase_vault` sont disponibles/activées.
4. Créer un secret aléatoire long (au moins 32 caractères) nommé `EDL_CLEANUP_SECRET) dans les secrets Edge Function.
5. Enregistrer les trois valeurs suivantes dans Vault (ne jamais les mettre dans Git) :
   - `edl_project_url` : URL du projet Supabase, par exemple `https://VOTRE_REF.supabase.co`
   - `edl_anon_key` : clé publishable/anon du projet
   - `edl_cleanup_secret` : exactement la même valeur que `EDL_CLEANUP_SECRET`

## Planification quotidienne

À exécuter dans l'éditeur SQL Supabase **après** le déploiement de la fonction et l'enregistrement des secrets Vault :

```sql
select cron.schedule(
  'edl-cleanup-daily',
  '17 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'edl_project_url')
      || '/functions/v1/edl-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'edl_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edl_anon_key'),
      'x-edl-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'edl_cleanup_secret')
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
  $$
);
```

Le déclenchement est quotidien à 00 h 17 UTC (04 h 17 à La Réunion). Il recherche les fichiers dont `delete_after` est atteint. Les fichiers encore valides ne sont jamais sélectionnés.

Pour vérifier le job :

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'edl-cleanup-daily';
```

Pour consulter les exécutions :

```sql
select start_time, end_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'edl-cleanup-daily')
order by start_time desc
limit 20;
```

Pour désactiver le job :

```sql
select cron.unschedule('edl-cleanup-daily');
```

## Tests avant mise en service

- Tester la fonction avec un secret incorrect : elle doit répondre HTTP 401.
- Créer un fichier EDL de test dans le bucket privé avec `delete_after` dans le passé, puis vérifier qu'il est supprimé du Storage et de la table.
- Vérifier qu'un fichier dont `delete_after` est dans le futur reste présent.
- Vérifier le cas d'échec Storage : la ligne de métadonnées doit être conservée pour permettre une nouvelle tentative.
- Ne jamais utiliser de vrais documents/photos clients pour les tests.

## Important

- La clôture du retour doit être appelée uniquement après signature et enregistrement du PDF de retour.
- La fonction SQL `cloturer_retour_etat_des_lieux(uuid)` fixe une seule fois `retour_effectif_at`, puis calcule `delete_after = retour_effectif_at + 14 jours` pour tous les fichiers de la réservation.
- La fonction de nettoyage supprime le Storage avant les lignes de métadonnées.
- Le déclencheur planifié n'est pas créé par la migration : cette étape séparée évite une migration bloquée si Vault ou les extensions ne sont pas configurés.
- Aucune clé, aucun secret et aucune donnée client ne doivent être commités dans Git.
