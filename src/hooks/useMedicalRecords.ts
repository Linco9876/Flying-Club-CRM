import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { MedicalRecord } from "../utils/medicalRecords";
export const MEDICALS_UPDATED = "member-medicals-updated";
export function useMedicalRecords(userId?: string) {
  const requestId = useRef(0);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (!userId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: failure } = await supabase
      .from("member_medicals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (request !== requestId.current) return;
    setError(failure?.message || null);
    setRecords(failure ? [] : ((data || []) as MedicalRecord[]));
    setLoading(false);
  }, [userId]);
  useEffect(() => {
    void refresh();
    window.addEventListener(MEDICALS_UPDATED, refresh);
    return () => window.removeEventListener(MEDICALS_UPDATED, refresh);
  }, [refresh]);
  return { records, loading, error, refresh };
}
