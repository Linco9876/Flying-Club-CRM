import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const normaliseCode = (value: unknown) =>
  String(value || "").trim().toUpperCase().replace(/\s+/g, "-");

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const overlaps = (aStart: Date | string, aEnd: Date | string, bStart: Date | string, bEnd: Date | string) =>
  new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getAuthenticatedUser = async (req: Request, supabaseUrl: string) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { user: null, error: "missing_authorization" };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) return { user: null, error: error?.message || "invalid_session" };
  return { user, error: null };
};

const aircraftMatchesProduct = (aircraft: any, product: any) => {
  const attachedIds = new Set<string>(product.aircraft_ids || []);
  if (attachedIds.size > 0 && attachedIds.has(aircraft.id)) return true;
  if (product.aircraft_mode === "specific") return attachedIds.has(aircraft.id);

  const label = `${aircraft.registration || ""} ${aircraft.make || ""} ${aircraft.model || ""}`.toLowerCase();
  if (product.aircraft_mode === "tecnam") return label.includes("tecnam");
  if (product.aircraft_mode === "archer") return label.includes("archer") || label.includes("pa-28");
  return false;
};

const timeForDate = (date: Date, time: string, fallbackHour: number, fallbackMinute = 0) => {
  const [hourRaw, minuteRaw] = String(time || "").slice(0, 5).split(":").map(Number);
  const hour = Number.isFinite(hourRaw) ? hourRaw : fallbackHour;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : fallbackMinute;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
};

const absenceBlocksTime = (absence: any, start: Date, end: Date) => {
  const startDate = dateKey(start);
  if (startDate < absence.start_date || startDate > absence.end_date) return false;
  const absenceStart = timeForDate(start, absence.start_time || "00:00", 0);
  const absenceEnd = timeForDate(start, absence.end_time || "23:59", 23, 59);
  return overlaps(start, end, absenceStart, absenceEnd);
};

const toPublicVoucher = (voucher: any, product: any) => ({
  code: voucher.code,
  status: voucher.status,
  recipientName: voucher.recipient_name,
  product: {
    name: product.name,
    description: product.description,
    aircraftMode: product.aircraft_mode,
    durationMinutes: product.duration_minutes,
    bookingBlockMinutes: Number(product.duration_minutes || 0) + 30,
    bookingInstructions: product.booking_instructions,
  },
});

const toPublicProduct = (product: any) => ({
  id: product.id,
  name: product.name,
  description: product.description,
  aircraftMode: product.aircraft_mode,
  durationMinutes: product.duration_minutes,
  bookingBlockMinutes: Number(product.duration_minutes || 0) + 30,
  price: Number(product.price || 0),
  bookingInstructions: product.booking_instructions,
});

const getBookingSummary = async (adminClient: ReturnType<typeof createClient>, bookingId?: string | null) => {
  if (!bookingId) return null;

  const { data: booking, error: bookingError } = await adminClient
    .from("bookings")
    .select("id,start_time,end_time,aircraft_id,instructor_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw bookingError;
  if (!booking) return null;

  const [{ data: aircraft }, { data: instructor }] = await Promise.all([
    booking.aircraft_id
      ? adminClient.from("aircraft").select("id,registration,make,model").eq("id", booking.aircraft_id).maybeSingle()
      : Promise.resolve({ data: null }),
    booking.instructor_id
      ? adminClient.from("users").select("id,name").eq("id", booking.instructor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    bookingId: booking.id,
    startTime: booking.start_time,
    endTime: booking.end_time,
    aircraftId: booking.aircraft_id,
    aircraftLabel: aircraft
      ? `${aircraft.registration || ""} ${aircraft.make || ""} ${aircraft.model || ""}`.trim()
      : "Aircraft",
    instructorId: booking.instructor_id,
    instructorName: instructor?.name || "Instructor",
  };
};

const buildAvailableSlots = async (adminClient: ReturnType<typeof createClient>, product: any) => {
  const blockMinutes = Number(product.duration_minutes || 0) + 30;
  const allowedInstructorIds = new Set<string>(product.instructor_ids || []);
  if (!blockMinutes || allowedInstructorIds.size === 0) return [];

  const [
    { data: aircraftRows, error: aircraftError },
    { data: bookings, error: bookingsError },
    { data: schedules, error: schedulesError },
    { data: absences, error: absencesError },
    { data: users, error: usersError },
  ] = await Promise.all([
    adminClient.from("aircraft").select("id,registration,make,model,status"),
    adminClient.from("bookings").select("id,aircraft_id,instructor_id,start_time,end_time,status,deleted_at,has_conflict"),
    adminClient.from("instructor_weekly_schedules").select("*"),
    adminClient.from("instructor_absences").select("*"),
    adminClient.from("users").select("id,name").in("id", Array.from(allowedInstructorIds)),
  ]);

  if (aircraftError) throw aircraftError;
  if (bookingsError) throw bookingsError;
  if (schedulesError) throw schedulesError;
  if (absencesError) throw absencesError;
  if (usersError) throw usersError;

  const eligibleAircraft = (aircraftRows || [])
    .filter((aircraft: any) => aircraft.status === "serviceable")
    .filter((aircraft: any) => aircraftMatchesProduct(aircraft, product));
  const userMap = new Map((users || []).map((user: any) => [user.id, user.name]));
  const now = new Date();
  const horizon = addMinutes(now, 60 * 24 * 45);
  const activeBookings = (bookings || []).filter((booking: any) =>
    !booking.deleted_at &&
    ["confirmed", "pending_approval"].includes(booking.status) &&
    new Date(booking.end_time) >= now &&
    new Date(booking.start_time) <= horizon
  );

  const slots: any[] = [];

  for (let dayOffset = 0; dayOffset < 45; dayOffset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayOfWeek = day.getDay();
    const daySchedules = (schedules || []).filter((schedule: any) =>
      schedule.is_available &&
      Number(schedule.day_of_week) === dayOfWeek &&
      allowedInstructorIds.has(schedule.user_id || schedule.instructor_id)
    );

    for (const schedule of daySchedules) {
      const instructorId = schedule.user_id || schedule.instructor_id;
      const windows = [
        [schedule.start_time, schedule.end_time],
        [schedule.afternoon_start_time || schedule.start_time_2, schedule.afternoon_end_time || schedule.end_time_2],
      ].filter(([start, end]) => start && end);

      for (const [windowStartRaw, windowEndRaw] of windows) {
        const windowStart = timeForDate(day, windowStartRaw, 9);
        const windowEnd = timeForDate(day, windowEndRaw, 17);
        for (let cursor = new Date(windowStart); addMinutes(cursor, blockMinutes) <= windowEnd; cursor = addMinutes(cursor, 30)) {
          const start = new Date(cursor);
          const end = addMinutes(start, blockMinutes);
          if (start < addMinutes(now, 120)) continue;
          if ((absences || []).some((absence: any) => (absence.user_id || absence.instructor_id) === instructorId && absenceBlocksTime(absence, start, end))) {
            continue;
          }

          const aircraft = eligibleAircraft.find((candidate: any) =>
            !activeBookings.some((booking: any) =>
              overlaps(start, end, booking.start_time, booking.end_time) &&
              (booking.aircraft_id === candidate.id || booking.instructor_id === instructorId)
            )
          );

          if (!aircraft) continue;

          slots.push({
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            aircraftId: aircraft.id,
            aircraftLabel: `${aircraft.registration} ${aircraft.make || ""} ${aircraft.model || ""}`.trim(),
            instructorId,
            instructorName: userMap.get(instructorId) || "Instructor",
          });

          if (slots.length >= 60) return slots;
        }
      }
    }
  }

  return slots;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const action = String(body.action || "verify");
    const code = normaliseCode(body.code);

    if (action === "products") {
      const { data: products, error: productsError } = await adminClient
        .from("trial_flight_voucher_products")
        .select("id,name,description,aircraft_mode,duration_minutes,price,booking_instructions,is_active")
        .eq("is_active", true)
        .order("duration_minutes", { ascending: true });

      if (productsError) return json({ error: productsError.message }, 500);
      return json({ products: (products || []).map(toPublicProduct) });
    }

    if (action === "my-voucher") {
      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "You need to sign in to view your voucher" }, 401);

      const { data: voucher, error: voucherError } = await adminClient
        .from("trial_flight_vouchers")
        .select(`
          *,
          trial_flight_voucher_products(
            id,
            name,
            description,
            aircraft_mode,
            aircraft_ids,
            instructor_ids,
            duration_minutes,
            booking_instructions,
            is_active
          )
        `)
        .eq("redeemed_by_user_id", user.id)
        .in("status", ["redeemed", "booked"])
        .order("redeemed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (voucherError) return json({ error: voucherError.message }, 500);
      if (!voucher) return json({ error: "No linked trial flight voucher was found for this account" }, 404);

      const product = voucher.trial_flight_voucher_products;
      if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);

      const publicVoucher = toPublicVoucher(voucher, product);
      const slots = voucher.status === "redeemed" ? await buildAvailableSlots(adminClient, product) : [];
      const booking = voucher.status === "booked" ? await getBookingSummary(adminClient, voucher.booked_booking_id) : null;
      return json({ voucher: publicVoucher, slots, booking });
    }

    if (!code) return json({ error: "Voucher code is required" }, 400);

    const { data: voucher, error: voucherError } = await adminClient
      .from("trial_flight_vouchers")
      .select(`
        *,
        trial_flight_voucher_products(
          id,
          name,
          description,
          aircraft_mode,
          aircraft_ids,
          instructor_ids,
          duration_minutes,
          booking_instructions,
          is_active
        )
      `)
      .eq("code", code)
      .maybeSingle();

    if (voucherError) return json({ error: voucherError.message }, 500);
    if (!voucher) return json({ error: "Voucher code was not found" }, 404);
    if (voucher.status === "cancelled" || voucher.status === "expired") {
      return json({ error: "This voucher is no longer valid" }, 410);
    }
    if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
      await adminClient.from("trial_flight_vouchers").update({ status: "expired" }).eq("id", voucher.id);
      return json({ error: "This voucher has expired" }, 410);
    }

    const product = voucher.trial_flight_voucher_products;
    if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);

    const publicVoucher = toPublicVoucher(voucher, product);

    if (action === "verify") {
      return json({ voucher: publicVoucher });
    }

    if (action === "availability") {
      if (voucher.status === "booked" || voucher.booked_booking_id) {
        return json({ error: "This voucher has already been booked" }, 409);
      }
      if (voucher.status !== "redeemed" || !voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher and sign in before viewing available times" }, 409);
      }

      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "Sign in to your voucher account before viewing available times" }, 401);
      if (user.id !== voucher.redeemed_by_user_id) {
        return json({ error: "This voucher is linked to a different account" }, 403);
      }

      if (!["redeemed"].includes(voucher.status)) {
        return json({ error: "This voucher is not available for booking" }, 409);
      }

      const slots = await buildAvailableSlots(adminClient, product);
      return json({ voucher: publicVoucher, slots });
    }

    if (action === "book") {
      if (!voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher before booking a time" }, 409);
      }
      if (voucher.status === "booked" || voucher.booked_booking_id) {
        return json({ error: "This voucher already has a booking" }, 409);
      }

      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "Sign in to your voucher account before booking a time" }, 401);
      if (user.id !== voucher.redeemed_by_user_id) {
        return json({ error: "This voucher is linked to a different account" }, 403);
      }

      const startTime = new Date(String(body.startTime || ""));
      const aircraftId = String(body.aircraftId || "");
      const instructorId = String(body.instructorId || "");
      const blockMinutes = Number(product.duration_minutes || 0) + 30;
      const endTime = addMinutes(startTime, blockMinutes);

      if (!Number.isFinite(startTime.getTime()) || !aircraftId || !instructorId) {
        return json({ error: "A valid time, aircraft and instructor are required" }, 400);
      }

      const slots = await buildAvailableSlots(adminClient, product);
      const matchingSlot = slots.find((slot: any) =>
        slot.startTime === startTime.toISOString() &&
        slot.aircraftId === aircraftId &&
        slot.instructorId === instructorId
      );

      if (!matchingSlot) {
        return json({ error: "That time is no longer available. Please choose another time." }, 409);
      }

      const { data: booking, error: bookingError } = await adminClient
        .from("bookings")
        .insert({
          student_id: voucher.redeemed_by_user_id,
          aircraft_id: aircraftId,
          instructor_id: instructorId,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          payment_type: "prepaid",
          status: "confirmed",
          has_conflict: false,
          notes: `Trial flight voucher ${voucher.code} - ${product.name}`,
          trial_flight_voucher_id: voucher.id,
        })
        .select("id")
        .single();

      if (bookingError || !booking) {
        return json({ error: bookingError?.message || "Could not create booking" }, 500);
      }

      const { error: voucherUpdateError } = await adminClient
        .from("trial_flight_vouchers")
        .update({
          status: "booked",
          booked_booking_id: booking.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", voucher.id);

      if (voucherUpdateError) return json({ error: voucherUpdateError.message }, 500);

      return json({
        voucher: { ...publicVoucher, status: "booked" },
        bookingId: booking.id,
        booking: { ...matchingSlot, bookingId: booking.id },
      });
    }

    if (action !== "redeem") return json({ error: "Unsupported action" }, 400);

    if (voucher.status === "booked") return json({ error: "This voucher has already been booked" }, 409);

    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();

    if (!fullName || !email || !phone) {
      return json({ error: "Full name, email and phone are required" }, 400);
    }

    const { data: existingProfile } = await adminClient
      .from("users")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    let userId = existingProfile?.id;

    if (!userId) {
      const tempPassword = crypto.randomUUID() + "A1!";
      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name: fullName, phone },
      });

      if (authError || !authData.user) {
        return json({ error: authError?.message || "Failed to create voucher account" }, 500);
      }

      userId = authData.user.id;

      const { error: userError } = await adminClient.from("users").upsert({
        id: userId,
        email,
        name: fullName,
        phone,
        role: "student",
        portal_access_scope: "trial_voucher",
      });

      if (userError) return json({ error: userError.message }, 500);

      await adminClient.from("user_roles").upsert({ user_id: userId, role: "student" }, { onConflict: "user_id,role" });
      await adminClient.from("students").upsert({ id: userId, prepaid_balance: 0 }, { onConflict: "id" });
    }

    const { error: redeemError } = await adminClient
      .from("trial_flight_vouchers")
      .update({
        status: voucher.status === "issued" ? "redeemed" : voucher.status,
        redeemed_at: voucher.redeemed_at || new Date().toISOString(),
        redeemed_by_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id);

    if (redeemError) return json({ error: redeemError.message }, 500);

    const redirectTo = String(body.redirectTo || "").trim() || undefined;
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });

    return json({
      voucher: publicVoucher,
      userId,
      setupLink: linkData?.properties?.action_link || null,
      message: "Voucher verified. Account created and voucher linked.",
    });
  } catch (error) {
    console.error("trial-voucher-public error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
