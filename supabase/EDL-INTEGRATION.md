# États des lieux Maloé Location — intégration à valider

Cette branche prépare l'intégration des états des lieux de départ et de retour. Elle ne déploie rien sur le site public et n'applique aucune modification à Supabase.

## Éléments ajoutés

- `etat-des-lieux.html` : interface mobile, authentification administrateur EDL, choix d'une réservation, photos par article, signatures client/loueur, PDF séparés, rappel des photos et observations de départ au retour.
- `admin.html` : lien d'accès depuis l'administration.
- `supabase/migrations/20261105_edl_signatures_and_id_photo.sql` : ajoute la signature du loueur, l'unicité d'un constat par étape et le type de fichier pour la copie d'identité.
- `supabase/functions/edl-records/index.ts` : lecture et sauvegarde des observations/signatures, accès limité aux comptes avec `app_metadata.edl_access = true`, pas d'écrasement d'un constat déjà enregistré.
- `supabase/functions/edl-id-photo/index.ts` : stockage privé d'une copie filigranée, une seule copie par réservation, lien de consultation temporaire.
- `supabase/functions/edl-documents/index.ts` : PDF uniquement après sauvegarde du constat; clôture du retour seulement après PDF.
- `supabase/functions/edl-reservations/index.ts` : ajoute la date réelle de clôture au résultat.

## Ordre de mise en service (après approbation)

1. Faire une sauvegarde de la base et vérifier la configuration du bucket privé `etats-des-lieux`.
2. Appliquer la migration SQL.
3. Déployer les fonctions `edl-records`, `edl-id-photo`, puis les versions mises à jour de `edl-documents` et `edl-reservations`.
4. Garder `edl-photos` et `edl-cleanup` actives; la tâche de nettoyage quotidienne existante doit rester active.
5. Publier les fichiers du site seulement après les tests.
6. Effectuer les essais avec une réservation de test explicitement créée à cet effet. Ne pas utiliser la réservation déjà présente dans la base comme donnée de test sans confirmation.

## Tests à effectuer avant ouverture

- Connexion : compte EDL autorisé accepté; compte sans `edl_access` refusé.
- Accès aux réservations et aux données uniquement via les fonctions serveur.
- Photo : format autorisé, taille maximale 10 Mo, maximum 3 par article et par étape.
- Copie d'identité : filigrane visible, seule la copie filigranée envoyée, bucket privé, lien signé temporaire.
- Départ : observations et deux signatures sauvegardées, PDF de départ privé.
- Retour sans départ : refusé.
- Retour : photos du départ consultables, nouvelles observations/signatures sauvegardées, PDF de retour privé.
- Clôture : `retour_effectif_at` rempli après PDF de retour; `delete_after` fixé à 14 jours.
- Nettoyage : les objets expirés sont supprimés par le cron existant.

## Protection des données

La copie d'une pièce d'identité est une donnée personnelle sensible au regard des risques d'usurpation. La collecte doit être justifiée, annoncée au client et limitée au strict nécessaire. Le filigrane réduit les risques de réutilisation mais ne remplace pas ces obligations. L'interface n'intègre pas la copie d'identité au PDF de location. Les fichiers sont privés et le nettoyage est déclenché à la clôture du retour.

## État actuel

Aucune migration n'a été appliquée, aucune fonction n'a été déployée, aucune réservation n'a été modifiée et le site public n'a pas été mis à jour. Les tests d'intégration réels restent à faire après approbation et activation coordonnée de la base et des fonctions.
