# États des lieux Maloé Location — intégration à valider

Cette branche contient l'intégration des états des lieux de départ et de retour. La migration SQL correspondante est déjà enregistrée dans Supabase (version 20261105151549). Les fonctions EDL sont déjà actives dans le projet ; la publication du site reste à effectuer.

## Éléments ajoutés

- `etat-des-lieux.html` : interface mobile, authentification administrateur EDL, choix d'une réservation, photos par article, signatures client/loueur, PDF séparés, rappel des photos et observations de départ au retour.
- `admin.html` : lien d'accès depuis l'administration.
- `supabase/migrations/20261105_edl_signatures_and_id_photo.sql` : ajoute la signature du loueur, l'unicité d'un constat par étape et le type de fichier pour la copie d'identité.
- `supabase/functions/edl-records/index.ts` : lecture et sauvegarde des observations/signatures, contrôle de la copie d'identité et d'au moins une photo au départ, contrôle du PDF de départ avant le retour, accès limité aux comptes avec `app_metadata.edl_access = true`, pas d'écrasement d'un constat déjà enregistré.
- `supabase/functions/edl-id-photo/index.ts` : stockage privé d'une copie filigranée, une seule copie par réservation, lien de consultation temporaire.
- `supabase/functions/edl-documents/index.ts` : PDF uniquement après sauvegarde du constat; clôture du retour seulement après PDF; consultation via liens signés temporaires (5 minutes) pour retrouver les PDF.
- `supabase/functions/edl-reservations/index.ts` : ajoute la date réelle de clôture au résultat.

## Ordre de mise en service (après approbation)

1. La migration `20261105151549_edl_signatures_and_id_photo` est déjà appliquée.
2. Les fonctions `edl-reservations`, `edl-photos`, `edl-records`, `edl-id-photo` et `edl-documents` sont déjà actives. `edl-cleanup` et sa tâche quotidienne sont conservées.
3. Vérifier le comportement complet sur une réservation de test créée à cet effet, puis la supprimer après les essais.
4. Publier les fichiers du site après validation des essais.

## Tests à effectuer avant ouverture

- Connexion : compte EDL autorisé accepté; compte sans `edl_access` refusé.
- Accès aux réservations et aux données uniquement via les fonctions serveur.
- Départ : impossible à valider sans copie d'identité filigranée, au moins une photo, les deux signatures et le PDF privé.
- Retour : impossible à enregistrer sans départ signé et PDF de départ.
- Photo : format autorisé, taille maximale 10 Mo, maximum 3 par article et par étape.
- Copie d'identité : filigrane visible, seule la copie filigranée envoyée, bucket privé, lien signé temporaire.
- Départ : observations et deux signatures sauvegardées, PDF de départ privé.
- Retour sans départ : refusé.
- Retour : photos du départ consultables, nouvelles observations/signatures sauvegardées, PDF de retour privé.
- Documents : PDF de départ accessible après le départ et PDF de départ + retour accessibles après clôture, via liens signés temporaires.
- Clôture : `retour_effectif_at` rempli après PDF de retour; `delete_after` fixé à 14 jours.
- Nettoyage : les objets expirés sont supprimés par le cron existant.

## Protection des données

La copie d'une pièce d'identité est une donnée personnelle à risque au regard de l'usurpation. La collecte doit être justifiée, annoncée au client et limitée au strict nécessaire. Le filigrane réduit les risques de réutilisation mais ne remplace pas ces obligations. L'interface n'intègre pas la copie d'identité au PDF de location. Les photos, PDF et copie d'identité sont privés et programmés pour suppression 14 jours après la clôture du retour. Les observations et signatures structurées dans `etats_des_lieux` restent en base après cette échéance dans cette version; leur durée de conservation devra être définie séparément avant mise en service.

## État actuel

La migration est appliquée et les fonctions EDL sont actives. Aucune réservation ni aucun fichier EDL n'est présent actuellement dans la base. Le site public n'a pas encore été mis à jour. Les tests complets dans un navigateur restent à faire.
