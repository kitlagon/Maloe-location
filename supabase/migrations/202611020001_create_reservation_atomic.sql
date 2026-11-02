-- Maloé Location : création atomique d'une réservation avec blocage temporaire du stock.
-- À exécuter dans Supabase SQL Editor. Aucun tarif ni stock de référence n'est modifié.

CREATE OR REPLACE FUNCTION public.create_reservation_atomic(
  p_client jsonb,
  p_date_retrait date,
  p_date_retour date,
  p_heure_retrait text,
  p_heure_retour text,
  p_lines jsonb,
  p_promo_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_reservation_id uuid := gen_random_uuid();
  v_days integer;
  v_tier text;
  v_total numeric := 0;
  v_caution numeric := 0;
  v_line jsonb;
  v_product produits%ROWTYPE;
  v_component record;
  v_material materiels%ROWTYPE;
  v_size text;
  v_qty integer;
  v_used integer;
  v_available integer;
  v_unit numeric;
  v_line_total numeric;
  v_allocations jsonb;
  v_item_details jsonb;
  v_cart_allocations jsonb := '[]'::jsonb;
  v_cart_used integer;
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  v_now timestamptz := now();
BEGIN
  -- Verrou global : deux créations ne peuvent pas calculer le stock simultanément.
  PERFORM pg_advisory_xact_lock(hashtextextended('maloe-location-reservation-stock', 0));

  IF p_date_retrait IS NULL OR p_date_retour IS NULL OR p_date_retour < p_date_retrait THEN
    RAISE EXCEPTION 'Dates de location invalides.';
  END IF;
  IF p_heure_retrait IS NULL OR p_heure_retour IS NULL
     OR p_heure_retrait !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR p_heure_retour !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Créneaux horaires invalides.';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Le panier est vide.';
  END IF;

  -- Même règle que le site : soirée après 17h, retour le lendemain avant 18h inclus = 1 jour.
  IF p_date_retour = p_date_retrait + 1
     AND p_heure_retrait >= '17:00' AND p_heure_retour <= '18:00' THEN
    v_days := 1;
  ELSE
    v_days := GREATEST(1, CEIL(
      EXTRACT(EPOCH FROM (
        (p_date_retour + p_heure_retour::time) -
        (p_date_retrait + p_heure_retrait::time)
      )) / 86400.0
    )::integer);
  END IF;

  v_tier := CASE WHEN v_days <= 2 THEN '1-2'
                 WHEN v_days <= 5 THEN '3-5' ELSE '5+' END;

  v_first_name := btrim(COALESCE(p_client->>'prenom',''));
  v_last_name := btrim(COALESCE(p_client->>'nom',''));
  v_email := lower(btrim(COALESCE(p_client->>'email','')));
  v_phone := btrim(COALESCE(p_client->>'telephone',''));
  IF v_first_name = '' OR v_last_name = '' OR v_email = '' OR v_phone = '' THEN
    RAISE EXCEPTION 'Les coordonnées client sont incomplètes.';
  END IF;
  IF v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Adresse e-mail invalide.';
  END IF;

  INSERT INTO clients (id, nom, prenom, email, telephone)
  VALUES (gen_random_uuid(), v_last_name, v_first_name, v_email, v_phone)
  RETURNING id INTO v_client_id;

  -- Vérifier tous les articles et composants avant de créer la réservation.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line->>'qty')::integer, 0);
    IF v_qty < 1 OR v_qty > 20 THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;

    SELECT * INTO v_product
    FROM produits
    WHERE id = (v_line->>'product_id')::uuid AND actif = true
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Un produit du panier est indisponible.'; END IF;

    v_unit := CASE v_tier
      WHEN '1-2' THEN v_product.prix_1_2j
      WHEN '3-5' THEN v_product.prix_3_5j
      ELSE v_product.prix_5j_plus
    END;

    v_allocations := '[]'::jsonb;
    FOR v_component IN
      SELECT pc.materiel_id, pc.quantite, pc.taille_requise, pc.composant_code
      FROM produit_composants pc
      WHERE pc.produit_id = v_product.id
    LOOP
      IF v_component.taille_requise THEN
        v_size := btrim(COALESCE(v_line->'sizes'->>v_component.composant_code,''));
        IF v_size = '' THEN
          RAISE EXCEPTION 'Veuillez choisir la taille pour %.', COALESCE(v_component.composant_code,'cet article');
        END IF;

        SELECT m.* INTO v_material
        FROM materiels m
        WHERE m.actif = true
          AND m.famille_code = v_component.composant_code
          AND m.taille = v_size
        ORDER BY m.id
        LIMIT 1
        FOR UPDATE;
      ELSE
        SELECT m.* INTO v_material
        FROM materiels m
        WHERE m.id = v_component.materiel_id AND m.actif = true
        FOR UPDATE;
      END IF;

      IF NOT FOUND THEN RAISE EXCEPTION 'Un composant du produit % est indisponible.', v_product.nom; END IF;

      SELECT COALESCE(SUM((a->>'qty')::integer),0) INTO v_used
      FROM reservations r
      JOIN reservation_items ri ON ri.reservation_id = r.id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ri.details->'allocations','[]'::jsonb)) a
      WHERE (a->>'materiel_id')::uuid = v_material.id
        AND r.date_retrait <= p_date_retour
        AND r.date_retour >= p_date_retrait
        AND (
          r.statut IN ('confirmee','payee','payée','en_cours','en_attente_paiement')
          AND (r.statut <> 'en_attente_paiement' OR r.expires_at > v_now)
        );

      SELECT COALESCE(SUM((x->>'qty')::integer),0) INTO v_cart_used
      FROM jsonb_array_elements(v_cart_allocations) x
      WHERE (x->>'materiel_id')::uuid = v_material.id;
      v_available := COALESCE(v_material.stock,0) - v_used - v_cart_used;
      IF v_available < (v_component.quantite * v_qty) THEN
        RAISE EXCEPTION 'Stock insuffisant pour % (%).', v_material.nom, COALESCE(v_material.taille,'');
      END IF;

      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'materiel_id', v_material.id,
        'qty', v_component.quantite * v_qty,
        'famille_code', v_material.famille_code,
        'taille', v_material.taille
      ));
      v_cart_allocations := v_cart_allocations || jsonb_build_array(jsonb_build_object(
        'materiel_id', v_material.id,
        'qty', v_component.quantite * v_qty
      ));
    END LOOP;

    v_line_total := v_unit * v_days * v_qty;
    v_total := v_total + v_line_total;
    v_caution := v_caution + (v_product.caution * v_qty);
  END LOOP;

  -- Code TEST volontairement refusé dans le flux public tant que le mode test n'est pas activé.
  IF NULLIF(btrim(COALESCE(p_promo_code,'')),'') IS NOT NULL THEN
    RAISE EXCEPTION 'Ce code promotionnel n’est pas disponible pour le moment.';
  END IF;

  INSERT INTO reservations (
    id, client_id, date_retrait, date_retour, heure_retrait, heure_retour,
    total, caution, statut, expires_at, mode_test, created_at
  ) VALUES (
    v_reservation_id, v_client_id, p_date_retrait, p_date_retour,
    p_heure_retrait, p_heure_retour, v_total, v_caution,
    'en_attente_paiement', v_now + interval '15 minutes', false, v_now
  );

  -- Deuxième passage pour enregistrer chaque ligne et ses composants réellement affectés.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := (v_line->>'qty')::integer;
    SELECT * INTO v_product FROM produits WHERE id = (v_line->>'product_id')::uuid;
    v_unit := CASE v_tier
      WHEN '1-2' THEN v_product.prix_1_2j
      WHEN '3-5' THEN v_product.prix_3_5j
      ELSE v_product.prix_5j_plus
    END;
    v_allocations := '[]'::jsonb;

    FOR v_component IN
      SELECT pc.materiel_id, pc.quantite, pc.taille_requise, pc.composant_code
      FROM produit_composants pc WHERE pc.produit_id = v_product.id
    LOOP
      IF v_component.taille_requise THEN
        v_size := btrim(v_line->'sizes'->>v_component.composant_code);
        SELECT m.* INTO v_material FROM materiels m
        WHERE m.actif = true AND m.famille_code = v_component.composant_code AND m.taille = v_size
        ORDER BY m.id LIMIT 1;
      ELSE
        SELECT m.* INTO v_material FROM materiels m
        WHERE m.id = v_component.materiel_id AND m.actif = true;
      END IF;
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'materiel_id', v_material.id,
        'qty', v_component.quantite * v_qty,
        'famille_code', v_material.famille_code,
        'taille', v_material.taille
      ));
    END LOOP;

    v_item_details := jsonb_build_object(
      'sizes', COALESCE(v_line->'sizes','{}'::jsonb),
      'allocations', v_allocations,
      'duration_days', v_days
    );
    INSERT INTO reservation_items (
      id, reservation_id, produit_id, quantite, prix_unitaire, caution_unitaire, details
    ) VALUES (
      gen_random_uuid(), v_reservation_id, v_product.id, v_qty,
      v_unit, v_product.caution, v_item_details
    );
  END LOOP;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'status', 'en_attente_paiement',
    'expires_at', v_now + interval '15 minutes',
    'total', v_total,
    'caution', v_caution,
    'duration_days', v_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_reservation_atomic(jsonb,date,date,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_atomic(jsonb,date,date,text,text,jsonb,text) TO service_role;
