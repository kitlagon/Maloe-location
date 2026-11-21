export function computeComponentUsage(lines, findProduct) {
  const usage = {};
  for (const { id, sizes, qty } of lines) {
    const product = findProduct(id);
    for (const requirement of product?.components ?? []) {
      const size = requirement.needsSize ? sizes[requirement.id] : null;
      const key = requirement.id + '|' + (size || '');
      usage[key] = (usage[key] || 0) + qty * (requirement.qty || 1);
    }
  }
  return usage;
}

export function componentRemaining(component, size, usage) {
  if (!component) return Infinity;
  const stock = component.sizes ? component.stock?.[size] : component.stock;
  if (stock == null) return Infinity;
  return stock - (usage[component.id + '|' + (size || '')] || 0);
}

export function findBlockingComponent(item, sizes, quantity, usage, findComponent) {
  for (const requirement of item.components ?? []) {
    const size = requirement.needsSize ? sizes[requirement.id] : null;
    const remaining = componentRemaining(findComponent(requirement.id), size, usage);
    if (remaining < quantity * (requirement.qty || 1)) {
      return { componentId: requirement.id, size };
    }
  }
  return null;
}
