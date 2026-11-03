-- Maloé Location : stockage privé des PDF d'états des lieux.
-- Préparation uniquement : cette migration n'est pas appliquée à Supabase par ce commit.
-- Les fichiers restent privés et ne sont accessibles qu'aux fonctions serveur utilisant service_role.
-- Aucun accès public ou accès direct depuis le navigateur n'est créé.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'etats-des-lieux',
  'etats-des-lieux',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf']::text[];

CREATE TABLE IF NOT EXISTS public.etat_des_lieux_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  etape text NOT NULL CHECK (etape IN ('depart', 'retour')),
  bucket_id text NOT NULL DEFAULT 'etats-des-lieux'
    CHECK (bucket_id = 'etats-des-lieux'),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf'
    CHECK (mime_type = 'application/pdf'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz,
  CONSTRAINT etat_des_lieux_documents_one_per_stage
    UNIQUE (reservation_id, etape)
);

CREATE INDEX IF NOT EXISTS idx_etat_des_lieux_documents_reservation
  ON public.etat_des_lieux_documents (reservation_id);

ALTER TABLE public.etat_des_lieux_documents ENABLE ROW LEVEL SECURITY;

-- Pas de policy anon/authenticated volontairement :
-- la lecture, l'écriture et la création de liens temporaires devront passer
-- par une Edge Function qui vérifie les droits avant d'utiliser service_role.

COMMENT ON TABLE public.etat_des_lieux_documents IS
  'Références des PDF privés de départ et de retour associés aux réservations Maloé Location.';

COMMENT ON COLUMN public.etat_des_lieux_documents.storage_path IS
  'Chemin interne du PDF dans le bucket privé etats-des-lieux ; ne jamais exposer une URL publique.';
