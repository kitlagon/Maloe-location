# Planning du matériel

`planning.html` est une page indépendante du parcours client, accessible depuis `admin.html`.
Elle utilise le compte Supabase existant et vérifie `is_admin()` avant toute lecture.
Les lectures passent par les politiques RLS existantes. Aucune clé secrète, aucune modification de réservation ou de stock.

- Vues jour, semaine (lundi à dimanche), mois et trois mois ; dates et actualisation en heure de La Réunion.
- Les composants d'un kit utilisent les allocations enregistrées dans `reservation_items.details.allocations` ; leur quantité est déjà totale.
- Pour les anciennes réservations, une reconstruction n'est faite que si le composant et la taille permettent une correspondance unique. Toute information manquante est signalée.
- Les numéros d'unité sont des repères recalculés pour l'affichage et ne constituent pas une affectation physique persistante.
- Les jours de retrait et de retour restent occupés, conformément au calcul conservateur du stock du serveur.
- Les demandes de paiement arrivées à expiration et les annulations sont exclues. Un dépassement est affiché sur une ligne d'alerte.
- Les statuts de départ et de retour s'appuient sur les états des lieux enregistrés ; le paiement reprend le statut Stancer enregistré sans lancer de transaction.
- Actualisation à l'ouverture, au retour sur l'onglet et toutes les 60 secondes lorsque le planning est visible.

Validation : `node --test tests/planning.test.mjs` et `node --check planning.mjs`.
