-- Maloé Location : stockage privé des PDF et photos des états des lieux.
-- Préparation uniquement : cette migration n'est pas appliquée à Supabase.
-- Tous les fichiers sont privés. Les accès devront passer par des Edge Functions
-- qui vérifient les droits avant d'utiliser service_role.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'etats-des-lieux',
  'etats-des-lieux',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[];

-- Un enregistrement par fichier : PDF de départ/retour ou photo.
-- Les photos du départ restent ainsi accessibles à l'écran de retour
-- pour comparer l'état initial et l'état constaté à la restitution.
CREATE TABLE IF NOT EXISTS public.etat_des_lieux_fichiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  reservation_item_id uuid REFERENCES public.reservation_items(id) ON DELETE CASCADE,
  etape text NOT NULL CHECK (etape IN ('depart', 'retour')),
  type_fichier text NOT NULL CHECK (type_fichier IN ('pdf', 'photo')),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (
    mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz
);

-- Un seul PDF par étape, mais autant de photos que nécessaire.
-- Chaque photo peut être rattachée à une ligne de réservation pour l'affichage par matériel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_edl_pdf_one_per_stage
  ON public.etat_des_lieux_fichiers (reservation_id, etape)
  WHERE type_fichier = 'pdf';

CREATE INDEX IF NOT EXISTS idx_edl_fichiers_reservation_item
  ON public.etat_des_lieux_fichiers (reservation_item_id)
  WHERE reservation_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_edl_fichiers_reservation_etape
  ON public.etat_des_lieux_fichiers (reservation_id, etape);

CREATE INDEX IF NOT EXISTS idx_edl_fichiers_delete_after
  ON public.etat_des_lieux_fichiers (delete_after)
  WHERE delete_after IS NOT NULL;

ALTER TABLE public.etat_des_lieux_fichiers ENABLE ROW LEVEL SECURITY;

-- Pas de policy anon/authenticated volontairement :
-- lecture, écriture, génération de liens temporaires et suppression
-- devront passer par des Edge Functions sécurisées.

COMMENT ON TABLE public.etat_des_lieux_fichiers IS
  'PDF et photos privés des états des lieux de départ et de retour. Suppression 14 jours après le retour effectif.';

COMMENT ON COLUMN public.etat_des_lieux_fichiers.delete_after IS
  'Date limite de conservation. À renseigner à la clôture du retour : date/heure effective du retour + 14 jours. Un traitement planifié supprimera les fichiers échus du Storage puis leurs lignes.';


-- Date/heure réelle à laquelle Maloé Location clôture l'état des lieux de retour.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS retour_effectif_at timestamptz;

COMMENT ON COLUMN public.reservations.retour_effectif_at IS
  'Horodatage réel de clôture de l’état des lieux de retour. Déclenche le délai de conservation de 14 jours.';

-- À appeler depuis une Edge Function authentifiée après signature et création
-- du PDF de retour. La clôture est unique et fixe delete_after à J+14.
CREATE OR REPLACE FUNCTION public.cloturer_retour_etat_des_lieux(p_reservation_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retour_effectif_at timestamptz;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Réservation manquante.';
  END IF;

  -- Il faut que le PDF de retour soit déjà enregistré avant de clôturer.
  IF NOT EXISTS (
    SELECT 1
    FROM public.etat_des_lieux_fichiers
    WHERE reservation_id = p_reservation_id
      AND etape = 'retour'
      AND type_fichier = 'pdf'
  ) THEN
    RAISE EXCEPTION 'Le PDF de retour doit être enregistré avant la clôture.';
  END IF;

  UPDATE public.reservations
  SET retour_effectif_at = COALESCE(retour_effectif_at, now())
  WHERE id = p_reservation_id
  RETURNING retour_effectif_at INTO v_retour_effectif_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Réservation introuvable.';
  END IF;

  UPDATE public.etat_des_lieux_fichiers
  SET delete_after = v_retour_effectif_at + interval '14 days'
  WHERE reservation_id = p_reservation_id;

  RETURN v_retour_effectif_at;
END;
$$;

REVOKE ALL ON FUNCTION public.cloturer_retour_etat_des_lieux(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloturer_retour_etat_des_lieux(uuid)
  TO service_role;
