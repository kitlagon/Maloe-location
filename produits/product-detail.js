const productPageParams = new URLSearchParams(window.location.search);
const bookingKeys = ['retrait', 'retour', 'slotRetrait', 'slotRetour', 'cart'];
const hasSelectedDates = Boolean(productPageParams.get('retrait') && productPageParams.get('retour'));
const productId = document.body.dataset.product;

for (const link of document.querySelectorAll('[data-home-link], [data-product-link]')) {
  const url = new URL(link.href);
  for (const key of bookingKeys) {
    if (productPageParams.has(key)) url.searchParams.set(key, productPageParams.get(key));
  }
  if (link.hasAttribute('data-booking-link') && hasSelectedDates) {
    url.hash = 'produit-' + productId;
    link.textContent = 'Choisir cet équipement';
  }
  link.href = url.pathname + url.search + url.hash;
}

const euros = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
});

async function loadProductDetails() {
  const response = await fetch('/products.json');
  if (!response.ok) return;
  const catalogue = await response.json();
  const item = catalogue.groups.flatMap((group) => group.items).find((entry) => entry.id === productId);
  if (!item) return;

  const photo = document.querySelector('[data-product-photo]');
  if (photo && catalogue.photoVersion) photo.src += '?v=' + encodeURIComponent(catalogue.photoVersion);

  const price = document.querySelector('[data-product-price]');
  const rate = item.pricesTotal?.[0] ?? item.prices?.[2];
  if (Number.isFinite(rate)) {
    const upcoming = !document.querySelector('[data-booking-link]');
    price.textContent = upcoming
      ? 'Tarif prévu pour une journée · ' + euros.format(rate)
      : 'À partir de ' + euros.format(rate) + ' / jour dès 6 jours';
    price.hidden = false;
  }

  const caution = document.querySelector('[data-product-caution]');
  if (Number.isFinite(item.caution) && item.caution > 0) {
    caution.textContent = 'Caution au retrait · ' + euros.format(item.caution);
    caution.hidden = false;
  }

  const sizes = document.querySelector('[data-product-sizes]');
  for (const requirement of item.components.filter((component) => component.needsSize)) {
    const component = catalogue.components.find((entry) => entry.id === requirement.id);
    if (!component?.sizes?.length) continue;
    const row = document.createElement('li');
    row.textContent = component.name + ' · ' + component.sizes.join(', ');
    sizes.appendChild(row);
  }
  sizes.hidden = !sizes.childElementCount;
}

loadProductDetails().catch(() => {
  // The static product description and catalogue links remain available.
});
