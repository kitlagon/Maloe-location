import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const catalogue = JSON.parse(readFileSync(new URL('products.json', root), 'utf8'));
const origin = 'https://maloe-location.re';
const copy = {
  glaciere: {
    title: 'Location de sac à dos glacière à l’Ermitage',
    intro: 'Emportez boissons et pique-nique à la plage ou en balade dans un sac à dos glacière de 20 L.',
    included: ['Sac à dos glacière de 20 L', 'Deux pains de glace'],
  },
  parasol: {
    title: 'Location de parasol à l’Ermitage',
    intro: 'Installez un coin d’ombre pour deux à la plage de l’Ermitage.',
    included: ['Parasol deux places avec protection UPF 50+', 'Pied à vis'],
  },
  pmt: {
    title: 'Location de kit snorkeling à l’Ermitage',
    intro: 'Réunissez tout le matériel de snorkeling pour observer le lagon depuis la surface. Choisissez séparément la pointure des palmes et la taille du masque.',
    included: ['Une paire de palmes', 'Un masque de snorkeling', 'Un tuba'],
  },
  'palme-easy': {
    title: 'Location de palmes et masque Easybreath à l’Ermitage',
    intro: 'Associez des palmes à un masque intégral Easybreath pour observer les fonds du lagon en surface.',
    included: ['Une paire de palmes', 'Un masque intégral Easybreath'],
  },
  'masque-tuba': {
    title: 'Location de masque et tuba à l’Ermitage',
    intro: 'Le duo classique pour observer les poissons du lagon en surface. Cette formule est pratique si vous avez déjà vos palmes.',
    included: ['Un masque de snorkeling', 'Un tuba'],
  },
  easybreath: {
    title: 'Location de masque Easybreath à l’Ermitage',
    intro: 'Un masque intégral avec tuba intégré pour respirer par le nez et la bouche pendant vos sorties en surface.',
    included: ['Un masque intégral Easybreath'],
  },
  palmes: {
    title: 'Location de palmes à l’Ermitage',
    intro: 'Louez une paire de palmes pour compléter votre équipement de snorkeling et vous déplacer dans le lagon.',
    included: ['Une paire de palmes'],
  },
  cam360: {
    title: 'Caméra 360° et accessoires aquatiques à l’Ermitage',
    intro: 'Une formule prévue pour filmer vos sorties dans le lagon à 360°.',
    included: ['Une caméra 360°', 'Une perche, un flotteur et une carte mémoire'],
    comingSoon: true,
  },
  'pmt-cam': {
    title: 'Kit snorkeling et caméra 360° à l’Ermitage',
    intro: 'Retrouvez le kit palmes, masque et tuba avec une caméra 360° pour filmer votre sortie dans le lagon.',
    included: ['Une paire de palmes', 'Un masque et un tuba', 'Une caméra 360° avec accessoires aquatiques'],
    comingSoon: true,
  },
  'easy-cam': {
    title: 'Palmes, masque Easybreath et caméra 360° à l’Ermitage',
    intro: 'Une formule qui associe des palmes, un masque intégral et une caméra 360° pour une sortie snorkeling à filmer.',
    included: ['Une paire de palmes', 'Un masque intégral Easybreath', 'Une caméra 360° avec accessoires aquatiques'],
    comingSoon: true,
  },
};

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value) => value.replace(/[&<>"']/g, (character) => entities[character]);
const productPath = (item) => `/produits/${item.pageSlug}/`;
const products = catalogue.groups.flatMap((group) => group.items).filter((item) => item.pageSlug);
const slugs = new Set();

for (const item of products) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pageSlug) || slugs.has(item.pageSlug) || !copy[item.id]) {
    throw new Error(`Fiche produit invalide pour ${item.id}`);
  }
  slugs.add(item.pageSlug);
}

for (const group of catalogue.groups) {
  for (const item of group.items.filter((item) => item.pageSlug)) {
    const { title, intro, included, comingSoon } = copy[item.id];
    const description = `${intro} ${comingSoon ? 'Nouveauté à venir chez Maloé Location.' : 'Réservation en ligne et retrait à l’Ermitage-les-Bains, La Réunion.'}`;
    const directory = new URL(productPath(item).slice(1), root);
    const related = group.items.filter((other) => other !== item && other.pageSlug);
    const reservation = comingSoon
      ? '<a class="product-detail-button" data-home-link href="/#catalogue">Voir le catalogue</a>'
      : `<form data-product-order hidden>
            <div class="product-detail-options" data-product-options></div>
            <button class="product-detail-button" type="submit">Ajouter au panier</button>
            <p class="product-detail-order-status" data-order-status role="status"></p>
          </form>
          <a class="product-detail-button" data-home-link data-booking-link href="/?produit=${item.id}#dates">Choisir mes dates</a>`;
    const media = comingSoon
      ? '<div class="product-detail-coming-soon">Nouveauté à venir !</div>'
      : `<img data-product-photo src="/images/kits/${item.id}.jpg" alt="${escape(item.name)}">`;

    mkdirSync(directory, { recursive: true });
    writeFileSync(new URL('index.html', directory), `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(title)} | Maloé Location</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="${origin}${productPath(item)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600;700&display=swap">
  <link rel="stylesheet" href="/styles/home-redesign.css">
  <link rel="stylesheet" href="/styles/product-detail.css">
  <script type="module" src="/produits/product-detail.js"></script>
</head>
<body data-product="${item.id}">
  <a class="skip-link" href="#main">Aller au contenu</a>
  <header>
    <div class="wrap product-detail-header">
      <a class="product-detail-brand" data-home-link href="/">
        <img src="/images/logo-hero.webp" width="52" height="52" alt="">
        Maloé Location
      </a>
      <a data-home-link href="/#catalogue">Nos équipements</a>
    </div>
  </header>
  <main id="main" class="wrap product-detail">
    <nav class="product-detail-breadcrumb" aria-label="Fil d’Ariane">
      <a data-home-link href="/#catalogue">Catalogue</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${escape(item.name)}</span>
    </nav>
    <article class="product-detail-layout">
      <div class="product-detail-media">
        ${media}
      </div>
      <div class="product-detail-content">
        <h1>${escape(title)}</h1>
        <p>${escape(intro)}</p>
        <section class="product-detail-booking" aria-label="Tarifs et réservation">
          <p data-product-price${comingSoon ? ' hidden' : ''}>${comingSoon ? '' : 'Consultez le tarif en choisissant vos dates.'}</p>
          <p data-product-caution hidden></p>
          ${reservation}
        </section>
        <section class="product-detail-included">
          <h2>Matériel inclus</h2>
          <ul>
            ${included.map((entry) => `<li>${escape(entry)}</li>`).join('\n            ')}
          </ul>${comingSoon ? '\n          <ul data-product-sizes hidden></ul>' : ''}
        </section>
        <section class="product-detail-pickup">
          <h2>Retrait à l’Ermitage-les-Bains</h2>
          <p>Retrait et retour sur rendez-vous rue des Maldives, près du centre équestre. Le point de rendez-vous précis est communiqué après la réservation.</p>
        </section>
      </div>
    </article>
    ${related.length ? `<section class="product-detail-related">
      <h2>Dans le même rayon</h2>
      <ul>
        ${related.map((other) => `<li><a data-product-link href="${productPath(other)}">${escape(other.name)}</a></li>`).join('\n        ')}
      </ul>
    </section>` : ''}
  </main>
  <footer>
    <div class="wrap footer-grid">
      <p>Maloé Location · L’Ermitage-les-Bains, La Réunion</p>
      <p><a href="/mentions-legales.html">Mentions légales</a> · <a href="/cgv.html">Conditions générales</a></p>
      <p><a href="mailto:contact@maloe-location.re">Contact</a></p>
    </div>
  </footer>
</body>
</html>
`);
  }
}

const urls = ['/', ...products.map(productPath)];
writeFileSync(new URL('sitemap.xml', root), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join('\n')}
</urlset>
`);
