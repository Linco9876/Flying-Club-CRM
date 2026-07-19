import { useCallback, useState } from 'react';
import * as Location from 'expo-location';
import type { DutyLocation, GeoResult } from '../types';
import { nearestDutyLocation } from '../utils/geo';

const initialResult: GeoResult = {
  insideGeofence: false,
  label: 'Checking location…',
};

export const useStartLocation = (locations: DutyLocation[]) => {
  const [geo, setGeo] = useState<GeoResult>(initialResult);
  const [locating, setLocating] = useState(false);

  const locate = useCallback(async () => {
    setLocating(true);
    setGeo(initialResult);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setGeo({ insideGeofence: false, label: 'Location permission not granted', error: 'GPS permission was not granted' });
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude, accuracy } = position.coords;
      const nearest = nearestDutyLocation(latitude, longitude, locations);
      const allowedDistance = nearest ? nearest.location.radiusMetres + Math.min(accuracy || 0, 100) : 0;
      const insideGeofence = Boolean(nearest && nearest.distance <= allowedDistance);
      let label = insideGeofence && nearest ? nearest.location.name : 'Off-site';

      if (!insideGeofence) {
        try {
          const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
          const address = addresses[0];
          label = [address?.name, address?.city || address?.district].filter(Boolean).join(', ') || 'Off-site';
        } catch {
          label = 'Off-site';
        }
      }

      setGeo({
        latitude,
        longitude,
        accuracyMetres: accuracy || undefined,
        nearestLocation: nearest?.location,
        distanceMetres: nearest?.distance,
        insideGeofence,
        label,
      });
    } catch (caught) {
      setGeo({
        insideGeofence: false,
        label: 'Location unavailable',
        error: caught instanceof Error ? caught.message : 'GPS location could not be read',
      });
    } finally {
      setLocating(false);
    }
  }, [locations]);

  return { geo, setGeo, locating, locate };
};
