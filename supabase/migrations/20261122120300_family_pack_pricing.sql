CREATE OR REPLACE FUNCTION public.create_reservation_atomic(p_client jsonb, p_date_retrait date, p_date_retour date, p_heure_retrait text, p_heure_retour text, p_lines jsonb, p_promo_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Le jour du retrait n'est pas facture si le retrait est a partir de 17h30.
  -- Duree minimale : 1 jour, meme pour un retrait et retour le meme jour.
  v_days := GREATEST(
    1,
    (p_date_retour - p_date_retrait) + 1 -
      CASE WHEN p_heure_retrait::time >= TIME '17:30' THEN 1 ELSE 0 END
  );

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

    v_unit := CASE
      WHEN v_line ? 'family_pack_price' THEN (v_line->>'family_pack_price')::numeric / v_days
      WHEN v_product.nom = 'Caméra 360° + accessoires aquatiques' THEN
        (CASE LEAST(v_days,7) WHEN 1 THEN 40 WHEN 2 THEN 75 WHEN 3 THEN 107 WHEN 4 THEN 137 WHEN 5 THEN 164 WHEN 6 THEN 186 ELSE 200 END + GREATEST(v_days-7,0)*14)::numeric / v_days
      WHEN v_product.nom IN ('Kit PMT + caméra','Palmes + Easybreath + caméra') THEN
        (CASE LEAST(v_days,7) WHEN 1 THEN 50 WHEN 2 THEN 87 WHEN 3 THEN 122 WHEN 4 THEN 153 WHEN 5 THEN 181 WHEN 6 THEN 205 ELSE 220 END + GREATEST(v_days-7,0)*15)::numeric / v_days
      ELSE CASE v_tier WHEN '1-2' THEN v_product.prix_1_2j WHEN '3-5' THEN v_product.prix_3_5j ELSE v_product.prix_5j_plus END
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
        AND ((r.date_retrait + COALESCE(NULLIF(r.heure_retrait,'')::time, TIME '00:00')) < (p_date_retour + p_heure_retour::time + interval '45 minutes'))
        AND ((r.date_retour + COALESCE(NULLIF(r.heure_retour,'')::time, TIME '23:59') + interval '45 minutes') > (p_date_retrait + p_heure_retrait::time))
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

    v_line_total := CASE WHEN v_line ? 'family_pack_price'
      THEN (v_line->>'family_pack_price')::numeric * v_qty
      ELSE v_unit * v_days * v_qty END;
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
    v_unit := CASE
      WHEN v_line ? 'family_pack_price' THEN (v_line->>'family_pack_price')::numeric / v_days
      WHEN v_product.nom = 'Caméra 360° + accessoires aquatiques' THEN
        (CASE LEAST(v_days,7) WHEN 1 THEN 40 WHEN 2 THEN 75 WHEN 3 THEN 107 WHEN 4 THEN 137 WHEN 5 THEN 164 WHEN 6 THEN 186 ELSE 200 END + GREATEST(v_days-7,0)*14)::numeric / v_days
      WHEN v_product.nom IN ('Kit PMT + caméra','Palmes + Easybreath + caméra') THEN
        (CASE LEAST(v_days,7) WHEN 1 THEN 50 WHEN 2 THEN 87 WHEN 3 THEN 122 WHEN 4 THEN 153 WHEN 5 THEN 181 WHEN 6 THEN 205 ELSE 220 END + GREATEST(v_days-7,0)*15)::numeric / v_days
      ELSE CASE v_tier WHEN '1-2' THEN v_product.prix_1_2j WHEN '3-5' THEN v_product.prix_3_5j ELSE v_product.prix_5j_plus END
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
    IF v_line ? 'family_pack_price' THEN
      v_item_details := v_item_details || jsonb_build_object('family_pack', true);
    END IF;
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
$function$;
REVOKE ALL ON FUNCTION public.create_reservation_atomic(jsonb,date,date,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_atomic(jsonb,date,date,text,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.family_pack_stock(
  p_start timestamp without time zone, p_end timestamp without time zone
)
RETURNS TABLE (family text, size text, available integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH used AS (
    SELECT (allocation->>'materiel_id')::uuid AS material_id,
           sum((allocation->>'qty')::integer) AS quantity
    FROM reservations r
    JOIN reservation_items ri ON ri.reservation_id = r.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ri.details->'allocations', '[]'::jsonb)) allocation
    WHERE p_start < p_end
      AND r.date_retrait + COALESCE(NULLIF(r.heure_retrait,'')::time, time '00:00')
            < p_end + interval '45 minutes'
      AND r.date_retour + COALESCE(NULLIF(r.heure_retour,'')::time, time '23:59')
            + interval '45 minutes' > p_start
      AND r.statut IN ('confirmee','payee','payée','en_cours','en_attente_paiement')
      AND (r.statut <> 'en_attente_paiement' OR r.expires_at > now())
    GROUP BY 1
  )
  SELECT m.famille_code, m.taille,
         greatest(0, coalesce(m.stock, 0) - coalesce(used.quantity, 0))::integer
  FROM materiels m
  LEFT JOIN used ON used.material_id = m.id
  WHERE p_start < p_end AND m.actif
    AND m.famille_code IN ('parasol-mat', 'glaciere-mat', 'palmes', 'masque-tuba', 'easybreath');
$$;

REVOKE ALL ON FUNCTION public.family_pack_stock(timestamp without time zone,timestamp without time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.family_pack_stock(timestamp without time zone,timestamp without time zone) TO anon, authenticated;
