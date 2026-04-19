import { useState, useEffect, useCallback } from 'react';
import { healthAPI } from '@/lib/api';
import type { RuntimeFormConfig } from '@/lib/formOptions';
import {
  DEFAULT_VEHICLE_TYPE_OPTIONS,
  DEFAULT_VISITOR_PURPOSES,
  DEFAULT_RESIDENT_VISIT_PURPOSE_LABEL,
  DEFAULT_RENTED_LOCATION_OPTIONS,
  DEFAULT_RESIDENT_STREETS,
} from '@/lib/formOptionsDefaults';

const FALLBACK_RUNTIME_CONFIG: RuntimeFormConfig = {
  ownerSmsDelayMinutes: 5,
  ownerSmsDelayDisabledForDemo: false,
  gracePeriodMinutes: 30,
  postGraceVerificationMinutes: 5,
  vehicleTypeOptions: [...DEFAULT_VEHICLE_TYPE_OPTIONS],
  visitorPurposes: [...DEFAULT_VISITOR_PURPOSES],
  residentVisitPurposeLabel: DEFAULT_RESIDENT_VISIT_PURPOSE_LABEL,
  rentedLocationOptions: [...DEFAULT_RENTED_LOCATION_OPTIONS],
  residentStreets: [...DEFAULT_RESIDENT_STREETS],
};

export function useFormOptions() {
  const [config, setConfig] = useState<RuntimeFormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await healthAPI.getRuntimeConfig()) as RuntimeFormConfig;
      setConfig(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setConfig({ ...FALLBACK_RUNTIME_CONFIG });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const effective = config ?? FALLBACK_RUNTIME_CONFIG;

  return {
    config: effective,
    loading,
    error,
    reload,
  };
}
