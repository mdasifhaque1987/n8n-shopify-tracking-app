export type Ga4AssetOption = {
  value: string;
  label: string;
};

export function getSavedGa4PropertyOption(
  propertyId: string,
  savedLabel?: string
) {
  const normalizedPropertyId = propertyId.trim();
  if (!normalizedPropertyId) return null;

  const normalizedLabel = savedLabel?.trim();
  return {
    value: normalizedPropertyId,
    label:
      normalizedLabel && normalizedLabel !== normalizedPropertyId
        ? normalizedLabel
        : `GA4 Property (${normalizedPropertyId})`,
  };
}

export function getGa4PropertyDisplayOptions(input: {
  savedPropertyId: string;
  savedPropertyLabel?: string;
  discoveredProperties: Ga4AssetOption[];
  locked: boolean;
}) {
  if (!input.locked) return input.discoveredProperties;
  const savedOption = getSavedGa4PropertyOption(
    input.savedPropertyId,
    input.savedPropertyLabel
  );
  return savedOption ? [savedOption] : [];
}

export function getGa4EmptyOptionText(hasSavedProperty: boolean) {
  return hasSavedProperty
    ? "Select GA4 Property"
    : "No GA4 properties found or API access pending";
}

export function isGa4ApiSecretConfigured(tokenStatus?: string | null) {
  return tokenStatus === "configured";
}

export function getGa4ApiSecretTitleColor(configured: boolean) {
  return configured ? "#15803d" : undefined;
}
