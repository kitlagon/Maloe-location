# Maloé Location — Site web

Site statique (une seule page `index.html`, sans backend). Prêt à héberger gratuitement sur GitHub + Cloudflare Pages.

## Déploiement

1. **Créer le dépôt GitHub**
   - Sur github.com, cliquez sur "New repository", nommez-le par ex. `kit-lagon`, laissez-le public, ne cochez aucune case d'initialisation.
2. **Envoyer les fichiers**
   ```
   cd kit-lagon
   git init
   git add .
   git commit -m "Premier site Maloé Location"
   git branch -M main
   git remote add origin https://github.com/VOTRE-PSEUDO/kit-lagon.git
   git push -u origin main
   ```
3. **Connecter Cloudflare Pages**
   - Sur dash.cloudflare.com → "Workers & Pages" → "Create application" → onglet "Pages" → "Connect to Git".
   - Autorisez Cloudflare à accéder à GitHub, choisissez le dépôt `kit-lagon`.
   - Configuration de build : laissez "Framework preset" sur "None", "Build command" vide, "Build output directory" sur `/` (racine).
   - Cliquez "Save and Deploy".
4. **Résultat**
   - Cloudflare donne une adresse du type `kit-lagon.pages.dev` en 1 à 2 minutes.
   - Chaque nouveau `git push` sur `main` redéploie automatiquement le site.
5. **Nom de domaine personnalisé (optionnel, plus tard)**
   - Dans le projet Pages → "Custom domains" → ajoutez `kitlagon.re` (ou autre) une fois le nom de domaine acheté.
