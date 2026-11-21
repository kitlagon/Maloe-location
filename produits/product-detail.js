import { computeComponentUsage, componentRemaining, findBlockingComponent } from '../catalogue-stock.mjs';

const productPageParams = new URLSearchParams(window.location.search);
const bookingKeys = ['retrait', 'retour', 'slotRetrait', 'slotRetour', 'cart'];
const hasSelectedDates = Boolean(productPageParams.get('retrait') && productPageParams.get('retour'));
const productId = document.body.dataset.product;
const bookingLink = document.querySelector('[data-booking-link]');
const orderForm = document.querySelector('[data-product-order]');
const navigationLinks = Array.from(
  document.querySelectorAll('[data-home-link], [data-product-link]'),
  (link) => ({ link, originalHref: link.href }),
);

const euros = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
});

function updateNavigation(hasCart = false) {
  for (const { link, originalHref } of navigationLinks) {
    const url = new URL(originalHref);
    if (link === bookingLink && hasSelectedDates) {
      if (hasCart) {
        url.pathname = '/panier.html';
        url.search = '';
        url.hash = '';
        link.textContent = 'Voir mon panier';
      } else if (orderForm.hidden) {
        url.hash = 'produit-' + productId;
        link.textContent = 'Choisir cet équipement';
      } else {
        link.textContent = 'Modifier mes dates';
      }
    }
    for (const key of bookingKeys) {
      if (productPageParams.has(key)) url.searchParams.set(key, productPageParams.get(key));
    }
    link.href = url.pathname + url.search + url.hash;
  }
}

function readCart(findProduct) {
  try {
    const lines = JSON.parse(productPageParams.get('cart') || '[]');
    if (Array.isArray(lines)) {
      return lines.filter((line) => line && findProduct(line.id) &&
        Number.isSafeInteger(line.qty) && line.qty > 0)
        .map((line) => ({ id: line.id, sizes: line.sizes || {}, qty: line.qty }));
    }
  } catch {
    // A malformed cart link starts with an empty cart.
  }
  return [];
}

function setupOrder(item, catalogue, requirements) {
  const products = catalogue.groups.flatMap((group) => group.items);
  const findProduct = (id) => products.find((product) => product.id === id);
  const findComponent = (id) => catalogue.components.find((component) => component.id === id);
  const lines = readCart(findProduct);
  const options = orderForm.querySelector('[data-product-options]');
  const submit = orderForm.querySelector('button');
  const status = orderForm.querySelector('[data-order-status]');
  const fields = requirements.map((requirement) => {
    const component = findComponent(requirement.id);
    const label = document.createElement('label');
    label.textContent = component.name;
    const select = document.createElement('select');
    select.name = requirement.id;
    select.required = true;
    const placeholder = new Option(requirement.id === 'palmes' ? 'Choisir la pointure' : 'Choisir la taille', '');
    placeholder.disabled = true;
    select.add(placeholder);
    for (const size of component.sizes) select.add(new Option(size, size));
    select.value = '';
    label.appendChild(select);
    options.appendChild(label);
    return { component, requirement, select };
  });
  options.hidden = !fields.length;

  function refreshAvailability() {
    const usage = computeComponentUsage(lines, findProduct);
    let unavailable = Boolean(findBlockingComponent(item, {}, 1, usage, findComponent));
    for (const { component, requirement, select } of fields) {
      const sizeOptions = Array.from(select.options).slice(1);
      for (const option of sizeOptions) {
        const remaining = componentRemaining(component, option.value, usage);
        const available = Math.floor(remaining / (requirement.qty || 1));
        option.disabled = available <= 0;
        option.textContent = option.value + (option.disabled ? ' · indisponible' :
          Number.isFinite(available) ? ' · ' + available + ' dispo' : '');
      }
      if (select.selectedOptions[0]?.disabled) select.value = '';
      unavailable ||= sizeOptions.every((option) => option.disabled);
    }
    submit.disabled = unavailable;
    return unavailable;
  }

  orderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!orderForm.reportValidity()) return;
    const sizes = Object.fromEntries(fields.map(({ requirement, select }) => [requirement.id, select.value]));
    const usage = computeComponentUsage(lines, findProduct);
    if (findBlockingComponent(item, sizes, 1, usage, findComponent)) {
      status.textContent = 'Cet équipement est indisponible dans la sélection actuelle.';
      refreshAvailability();
      return;
    }
    const matchingLine = lines.find((line) => line.id === item.id &&
      Object.entries(sizes).every(([id, size]) => line.sizes[id] === size));
    if (matchingLine) matchingLine.qty += 1;
    else lines.push({ id: item.id, sizes, qty: 1 });

    productPageParams.set('cart', JSON.stringify(lines));
    const currentUrl = new URL(window.location.href);
    currentUrl.search = productPageParams.toString();
    history.replaceState(history.state, '', currentUrl);
    updateNavigation(true);
    refreshAvailability();
    const quantity = lines.reduce((sum, line) => sum + line.qty, 0);
    status.textContent = 'Ajouté au panier. ' + quantity +
      (quantity === 1 ? ' article au total.' : ' articles au total.') +
      (hasSelectedDates ? '' : ' Choisissez vos dates pour continuer.');
  });

  orderForm.hidden = false;
  if (refreshAvailability()) status.textContent = 'Cet équipement est actuellement indisponible.';
  updateNavigation(lines.length > 0);
}

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
    const upcoming = !orderForm;
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

  const requirements = (item.components || []).filter((component) => component.needsSize);
  if (orderForm) {
    setupOrder(item, catalogue, requirements);
    return;
  }

  const sizes = document.querySelector('[data-product-sizes]');
  for (const requirement of requirements) {
    const component = catalogue.components.find((entry) => entry.id === requirement.id);
    if (!component?.sizes?.length) continue;
    const row = document.createElement('li');
    row.textContent = component.name + ' · ' + component.sizes.join(', ');
    sizes.appendChild(row);
  }
  sizes.hidden = !sizes.childElementCount;
}

updateNavigation();
loadProductDetails().catch(() => {
  // The static product description and catalogue links remain available.
});
