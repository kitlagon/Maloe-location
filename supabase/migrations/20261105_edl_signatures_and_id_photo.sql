-- Maloé Location — évolution EDL
-- À appliquer uniquement après revue et accord explicite.
-- Aucune donnée de réservation n'est supprimée ou modifiée par cette migration.

alter table public.etats_des_lieux
  add column if not exists signature_loueur text;

create unique index if not exists etats_des_lieux_reservation_type_uidx
  on public.etats_des_lieux (reservation_id, type);

alter table public.etat_des_lieux_fichiers
  drop constraint if exists etat_des_lieux_fichiers_type_fichier_check;

alter table public.etat_des_lieux_fichiers
  add constraint etat_des_lieux_fichiers_type_fichier_check
  check (type_fichier = any (array['pdf'::text, 'photo'::text, 'piece_identite'::text]));

-- La photo d'identité est classée à l'étape départ, sans article associé.
-- Elle reste dans le bucket privé et reçoit delete_after lors de la clôture du retour.

create unique index if not exists etat_des_lieux_fichiers_one_identity_per_reservation_uidx
  on public.etat_des_lieux_fichiers (reservation_id)
  where type_fichier = 'piece_identite';
