import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
type Result = {
  eligible: boolean;
  reason: string;
  medicalType?: string;
  effectiveExpiry?: string;
};
export function BookingMedicalCheck({
  bookingId,
  onClose,
}: {
  bookingId: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    flightDate?: string;
    pilot?: Result;
    instructor?: Result;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const check = useCallback(
    async (now = false) => {
      setBusy(true);
      setError("");
      const { data, error: failure } = await supabase.rpc(
        "check_booking_medicals",
        { p_booking_id: bookingId, p_use_current_time: now },
      );
      if (failure) setError(failure.message);
      else setResult(data);
      setBusy(false);
    },
    [bookingId],
  );
  useEffect(() => {
    void check();
  }, [check]);
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-medical-title"
    >
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 text-slate-900 shadow-xl dark:bg-slate-950 dark:text-slate-100">
        <div className="flex items-center justify-between">
          <h2 id="booking-medical-title" className="text-lg font-semibold">
            Licence and medical eligibility
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close medical check"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Checks the aircraft’s required licences and their accepted medicals
          for the flight. Instructor requirements are checked for supervised
          bookings.
        </p>
        {busy ? (
          <p className="flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} />
            Checkingâ€¦
          </p>
        ) : error ? (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        ) : (
          <>
            <p className="text-sm">
              Flight date checked: {result?.flightDate || "Not applicable"}
            </p>
            {(["pilot", "instructor"] as const).map((role) => {
              const item = result?.[role];
              return (
                item && (
                  <div
                    key={role}
                    className={`rounded-lg border p-3 ${item.eligible ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
                  >
                    <p className="font-semibold">
                      {role === "pilot" ? "Student / pilot" : "Instructor"}:{" "}
                      {item.eligible
                        ? "Medical check passed"
                        : "Requires attention"}
                    </p>
                    <p className="mt-1 text-sm">{item.reason}</p>
                    {item.medicalType && (
                      <p className="mt-1 text-xs">
                        {item.medicalType} Â· valid to {item.effectiveExpiry}
                      </p>
                    )}
                  </div>
                )
              );
            })}
          </>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void check(true)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Recheck for flight starting now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void check(false)}
            className="text-sm font-semibold text-blue-700"
          >
            Scheduled flight date
          </button>
        </div>
      </div>
    </div>
  );
}
