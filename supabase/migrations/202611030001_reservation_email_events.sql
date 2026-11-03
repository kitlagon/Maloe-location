-- Suivi idempotent des e-mails de confirmation.
-- Aucun e-mail n'est envoyé par cette migration.
-- L'envoi ne pourra être réservé que si paiement_confirme_at est renseigné.

CREATE TABLE IF NOT EXISTS public.reservation_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  email_type text NOT NULL CHECK (email_type IN ('client_confirmation', 'admin_notification')),
  status text NOT NULL DEFAULT 'en_cours'
    CHECK (status IN ('en_cours', 'envoye', 'echec')),
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT reservation_email_events_once UNIQUE (reservation_id, email_type)
);

ALTER TABLE public.reservation_email_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.reservation_email_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.reservation_email_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_reservation_email(
  p_reservation_id uuid,
  p_email_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_email_type NOT IN ('client_confirmation', 'admin_notification') THEN
    RAISE EXCEPTION 'Type de notification invalide.';
  END IF;

  -- La réservation doit avoir été confirmée par le processus serveur de paiement.
  IF NOT EXISTS (
    SELECT 1
    FROM public.reservations
    WHERE id = p_reservation_id
      AND paiement_confirme_at IS NOT NULL
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.reservation_email_events (
    reservation_id, email_type, status, updated_at
  )
  VALUES (p_reservation_id, p_email_type, 'en_cours', now())
  ON CONFLICT (reservation_id, email_type)
  DO UPDATE SET
    status = 'en_cours',
    last_error = NULL,
    updated_at = now()
  WHERE public.reservation_email_events.status = 'echec'
  RETURNING id INTO v_event_id;

  RETURN v_event_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_reservation_email(
  p_reservation_id uuid,
  p_email_type text,
  p_success boolean,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.reservation_email_events
  SET
    status = CASE WHEN p_success THEN 'envoye' ELSE 'echec' END,
    provider_message_id = CASE WHEN p_success THEN p_provider_message_id ELSE NULL END,
    last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'Erreur d’envoi'), 500) END,
    sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
    updated_at = now()
  WHERE reservation_id = p_reservation_id
    AND email_type = p_email_type
    AND status = 'en_cours';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun envoi en cours correspondant.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_reservation_email(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_reservation_email(uuid, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reservation_email(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_reservation_email(uuid, text, boolean, text, text) TO service_role;
