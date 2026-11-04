# Configuration Supabase — nettoyage automatique des états des lieux

Cette configuration est préparée sur la branche `feature/edl-double-signature`.
Elle ne déclenche rien tant que les fonctions ne sont pas déployées et que les étapes du Dashboard ne sont pas réalisées.

## 1. Autoriser l'appel planifié de la fonction

La fonction `edl-cleanup` vérifie elle-même le secret `x-edl-cleanup-secret`.
La vérification JWT du gateway doit donc être désactivée pour cette seule fonction ; ne pas désactiver la vérification JWT des autres fonctions.

Le fichier `supabase/config.toml` contient ce réglage.

## 2. Ajouter les secrets dans Supabase

Dans le Dashboard du projet, ouvrir **Project Settings → Edge Functions → Secrets** et ajouter :

- `EDL_CLEANUP_SECRET` : une longue valeur aléatoire, générée spécialement pour cette fonction.
- Vérifier que les secrets système `SUPABASE_URL` et `SUPABASE_SECRET_KEYS` sont disponibles pour la fonction.

Ne jamais mettre la valeur du secret dans GitHub, dans le code du site ou dans une migration SQL.

## 3. Préparer l'appel quotidien dans Vault

Après déploiement de la fonction et activation des extensions `pg_cron`, `pg_net` et `supabase_vault`, enregistrer l'URL du projet et le même secret dans **Vault** (Dashboard → Integrations → Vault), avec les noms exacts :

- `maloe_project_url` : URL du projet Supabase, par exemple `https://VOTRE-PROJECT-REF.supabase.co`.
- `maloe_edl_cleanup_secret` : la même valeur que `EDL_CLEANUP_SECRET`.
- `maloe_publishable_key` : la clé publique `sb_publishable_…` du projet, utilisée uniquement comme en-tête `apikey` pour l'appel au gateway.

Ne jamais placer une clé secrète (`sb_secret_…`) ou une ancienne clé `service_role` dans le cron. La fonction détient son accès serveur via `SUPABASE_SECRET_KEYS` et exige en plus le secret dédié.

## 4. Programmer l'appel

À exécuter dans le SQL Editor uniquement après les étapes précédentes :

```sql
select cron.schedule(
  'maloe-edl-cleanup-daily',
  '0 2 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'maloe_project_url'
    ) || '/functions/v1/edl-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'maloe_publishable_key'
      ),
      'x-edl-cleanup-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'maloe_edl_cleanup_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
```

L'horaire `0 2 * * *` correspond à 02:00 UTC chaque jour (06:00 à La Réunion).
Le nettoyage supprime uniquement les fichiers dont `delete_after` est arrivé à échéance. Le traitement est limité à 100 fichiers par passage.

## 5. Contrôle

Dans **Integrations → Cron**, vérifier l'existence du job `maloe-edl-cleanup-daily` et consulter son historique.
Contrôler également les réponses HTTP de `pg_net` et les journaux de la fonction Edge.

Ne pas considérer la suppression automatique comme active avant un test contrôlé confirmant qu'un fichier arrivé à échéance est supprimé du Storage et de la table de métadonnées.
