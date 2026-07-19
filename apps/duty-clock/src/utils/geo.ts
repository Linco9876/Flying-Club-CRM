import type { DutyLocation } from '../types';

const EARTH_RADIUS_METRES = 6_371_000;

const radians = (degrees: number) => degrees * Math.PI / 180;

export const distanceMetres = (latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) => {
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.asin(Math.sqrt(a));
};

export const nearestDutyLocation = (latitude: number, longitude: number, locations: DutyLocation[]) => {
  return locations
    .map(location => ({ location, distance: distanceMetres(latitude, longitude, location.latitude, location.longitude) }))
    .sort((a, b) => a.distance - b.distance)[0];
};

export const readableDistance = (metres?: number) => {
  if (metres === undefined) return '';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
};
