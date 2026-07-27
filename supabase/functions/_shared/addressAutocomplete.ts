export type PhotonAddressProperties = Record<string, unknown>;

const clean = (value: unknown) =>
  String(value || "").trim().replace(/\s+/g, " ");

export const photonLocality = (properties: PhotonAddressProperties) =>
  clean(
    properties.suburb ||
      properties.district ||
      properties.locality ||
      properties.village ||
      properties.town ||
      properties.city ||
      properties.county,
  );

export const photonAddress = (properties: PhotonAddressProperties) => {
  const street = clean(properties.street || properties.name);
  const firstLine = [clean(properties.housenumber), street]
    .filter(Boolean)
    .join(" ");
  const locality = photonLocality(properties);
  const state = clean(properties.state);
  const postcode = clean(properties.postcode);
  const country = clean(properties.country);
  return [
    firstLine,
    locality,
    [state, postcode].filter(Boolean).join(" "),
    country,
  ]
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index)
    .join(", ");
};
