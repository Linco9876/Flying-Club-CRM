import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { provisioningAccessFor } from "../_shared/userProvisioningRules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const cleanText = (value: unknown) => String(value || "").trim();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ProvisioningResult = {
  userId?: string;
  emailSent?: boolean;
  manualLink?: string;
  message?: string;
  error?: string;
};

const provisionProfile = async ({
  supabaseUrl,
  anonKey,
  authHeader,
  guest,
  role,
  sendInvitation,
  redirectTo,
}: {
  supabaseUrl: string;
  anonKey: string;
  authHeader: string;
  guest: { name: string; email: string; phone: string };
  role: "student" | "pilot";
  sendInvitation: boolean;
  redirectTo: string;
}) => {
  // Keep account creation in one hardened implementation. This also creates the
  // pending-account claim row when no email is requested.
  const response = await fetch(`${supabaseUrl}/functions/v1/invite-user`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: guest.email,
      name: guest.name,
      phone: guest.phone || null,
      roles: [role],
      sendInvitation,
      redirectTo,
    }),
  });
  const result = await response.json().catch(() => ({})) as ProvisioningResult;
  if (!response.ok || !result.userId) {
    throw new Error(result.error || result.message || "The portal profile could not be created");
  }
  return result;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return json({ error: "Unauthorized" }, 401);

    const { data: callerRoleRows, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);
    if (callerRolesError) throw callerRolesError;
    const callerRoles = (callerRoleRows || []).map((row) => String(row.role));

    const body = await req.json();
    const bookingId = cleanText(body.bookingId);
    const casualContactId = cleanText(body.casualContactId);
    const requestedEmail = cleanText(body.email).toLowerCase();
    const requestedTargetUserId = cleanText(body.targetUserId);
    const role = body.role === "pilot" ? "pilot" : "student";
    const linkAll = body.linkAll !== false;
    const sendInvitation = body.sendInvitation === true;
    const reactivateProfile = body.reactivateProfile === true;
    const redirectTo = cleanText(body.redirectTo) || `${Deno.env.get("PORTAL_ORIGIN") || "https://portal.bendigoflyingclub.com.au"}/reset-password`;

    if (!bookingId && !casualContactId) {
      return json({ error: "A booking or past visitor is required" }, 400);
    }
    if (bookingId && !uuidPattern.test(bookingId)) return json({ error: "A valid booking is required" }, 400);
    if (casualContactId && !uuidPattern.test(casualContactId)) {
      return json({ error: "A valid past visitor is required" }, 400);
    }
    if (requestedTargetUserId && !uuidPattern.test(requestedTargetUserId)) {
      return json({ error: "A valid target profile is required" }, 400);
    }
    if (!requestedEmail || !emailPattern.test(requestedEmail)) {
      return json({ error: "Enter a valid email address before upgrading this visitor" }, 400);
    }
    const access = provisioningAccessFor(callerRoles, [role]);
    if (!access.allowed) return json({ error: access.error || "Only staff can promote casual contacts" }, 403);

    const reactivatePortalProfile = async (targetUserId: string) => {
      const { data: target, error: targetError } = await adminClient
        .from("users")
        .select("id,is_active,portal_access_scope")
        .eq("id", targetUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.portal_access_scope === "guest_placeholder") {
        throw new Error("The linked portal profile is not available");
      }

      const needsActivation = target.is_active === false;
      const needsFullAccess = target.portal_access_scope === "trial_voucher";
      if (!reactivateProfile || (!needsActivation && !needsFullAccess)) return false;

      const { data: updatedRows, error: updateError } = await adminClient
        .from("users")
        .update({
          is_active: true,
          portal_access_scope: needsFullAccess ? "full" : target.portal_access_scope,
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetUserId)
        .select("id,is_active,portal_access_scope");
      if (updateError) throw updateError;
      const updated = updatedRows?.[0];
      if (!updated || updated.is_active !== true || updated.portal_access_scope === "guest_placeholder") {
        throw new Error("The portal profile could not be restored");
      }
      return true;
    };

    let contact: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      status: string;
      promoted_to_user_id: string | null;
    } | null = null;

    if (casualContactId) {
      const { data, error } = await adminClient
        .from("casual_contacts")
        .select("id,name,email,phone,status,promoted_to_user_id")
        .eq("id", casualContactId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.status === "merged") return json({ error: "Past visitor not found" }, 404);
      contact = data;

      if (contact.promoted_to_user_id) {
        if (requestedTargetUserId && requestedTargetUserId !== contact.promoted_to_user_id) {
          return json({ error: "This visitor is already linked to a different portal profile" }, 409);
        }
        const profileReactivated = await reactivatePortalProfile(contact.promoted_to_user_id);
        const { error: pilotFileError } = await adminClient
          .from("students")
          .upsert({ id: contact.promoted_to_user_id });
        if (pilotFileError) throw pilotFileError;
        return json({
          ok: true,
          action: profileReactivated ? "reactivated_profile" : "profile_already_active",
          memberId: contact.promoted_to_user_id,
          memberEmail: contact.email,
          emailSent: false,
          manualLink: null,
          linkAll: true,
          profileReactivated,
          transferred: {
            bookingCount: 0,
            flightLogCount: 0,
            trainingRecordCount: 0,
            reviewCount: 0,
          },
        });
      }
    }

    let booking: {
      id: string;
      is_guest_booking: boolean;
      guest_name: string | null;
      guest_email: string | null;
      guest_phone: string | null;
      casual_contact_id: string | null;
    } | null = null;

    if (bookingId) {
      const { data, error } = await adminClient
        .from("bookings")
        .select("id,is_guest_booking,guest_name,guest_email,guest_phone,casual_contact_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (error) throw error;
      booking = data;
    } else if (contact) {
      const { data, error } = await adminClient
        .from("bookings")
        .select("id,is_guest_booking,guest_name,guest_email,guest_phone,casual_contact_id")
        .eq("casual_contact_id", contact.id)
        .eq("is_guest_booking", true)
        .order("start_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      booking = data;
    }

    if (!booking) return json({ error: "No transferable visitor booking was found" }, 404);
    if (!booking.is_guest_booking) return json({ error: "This booking is already attached to a portal profile" }, 409);
    if (!booking.casual_contact_id) {
      return json({ error: "This booking needs the casual-contact database upgrade before it can be promoted" }, 409);
    }
    if (contact && booking.casual_contact_id !== contact.id) {
      return json({ error: "The booking does not belong to the selected visitor" }, 409);
    }

    const guest = {
      name: cleanText(contact?.name || booking.guest_name),
      email: requestedEmail,
      phone: cleanText(contact?.phone || booking.guest_phone),
    };
    if (!guest.name) return json({ error: "Guest name is required" }, 409);

    // Store the newly supplied current contact email for future visitor lookup,
    // while leaving every booking's point-in-time guest_email snapshot untouched.
    const promotionContactId = contact?.id || booking.casual_contact_id;
    const { error: contactEmailError } = await adminClient
      .from("casual_contacts")
      .update({ email: guest.email, updated_at: new Date().toISOString() })
      .eq("id", promotionContactId);
    if (contactEmailError) throw contactEmailError;

    let targetUserId = requestedTargetUserId;
    let provisioning: ProvisioningResult | null = null;
    let action: "linked_existing" | "created_profile" = "linked_existing";

    if (targetUserId) {
      const { data: target, error: targetError } = await adminClient
        .from("users")
        .select("id,email,portal_access_scope")
        .eq("id", targetUserId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.portal_access_scope === "guest_placeholder") {
        return json({ error: "The selected portal profile is not available" }, 404);
      }
    } else {
      const { data: exactMatches, error: exactMatchError } = await adminClient
        .from("users")
        .select("id,email,name,portal_access_scope")
        .ilike("email", guest.email)
        .neq("portal_access_scope", "guest_placeholder")
        .limit(2);
      if (exactMatchError) throw exactMatchError;
      if ((exactMatches || []).length === 1) {
        // Email is the portal login identity, so an exact unique match is safer
        // than creating a duplicate even if the UI list was stale or archived.
        targetUserId = cleanText(exactMatches![0].id);
        action = "linked_existing";
      } else if ((exactMatches || []).length > 1) {
        return json({
          error: "More than one portal profile uses this email. Select the correct profile before transferring records.",
        }, 409);
      } else {
        provisioning = await provisionProfile({
          supabaseUrl,
          anonKey,
          authHeader,
          guest,
          role,
          sendInvitation,
          redirectTo,
        });
        targetUserId = cleanText(provisioning.userId);
        action = "created_profile";
      }
    }

    const profileReactivated = await reactivatePortalProfile(targetUserId);

    const { error: pilotFileError } = await adminClient
      .from("students")
      .upsert({ id: targetUserId });
    if (pilotFileError) throw pilotFileError;

    const { data: transfer, error: transferError } = await adminClient.rpc(
      "promote_casual_contact_history",
      {
        p_booking_id: booking.id,
        p_target_user_id: targetUserId,
        p_link_all: linkAll,
        p_actor_id: callerUser.id,
      },
    );
    if (transferError) throw transferError;

    return json({
      ok: true,
      action,
      memberId: targetUserId,
      memberEmail: guest.email,
      emailSent: Boolean(provisioning?.emailSent),
      manualLink: provisioning?.manualLink || null,
      linkAll,
      profileReactivated,
      transferred: transfer,
    });
  } catch (error) {
    console.error("convert-guest-booking-to-member error:", error);
    return json({ error: error instanceof Error ? error.message : "The casual contact could not be promoted" }, 500);
  }
});
