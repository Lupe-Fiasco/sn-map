export function filterPlaces(features, query, selectedTypeIds) {
  const selected = new Set(Array.isArray(selectedTypeIds) ? selectedTypeIds : selectedTypeIds ? [selectedTypeIds] : []);
  const needle = String(query ?? "").trim().toLocaleLowerCase("zh-CN");
  return features.filter(({ properties = {} }) => {
    const haystack = `${properties.name ?? ""} ${properties.address ?? ""}`.toLocaleLowerCase("zh-CN");
    return (!selected.size || selected.has(properties.type)) && (!needle || haystack.includes(needle));
  });
}

export function toggleTypeSelection(selectedTypeIds, typeId) {
  const selected = new Set(selectedTypeIds);
  if (selected.has(typeId)) selected.delete(typeId);
  else selected.add(typeId);
  return [...selected];
}
