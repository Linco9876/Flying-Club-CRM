import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type MembershipWelcomeBrand,
  type MembershipWelcomeVariant,
  renderMembershipWelcomeEmail,
} from "../_shared/membershipWelcomeEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
const clean = (value: unknown) => String(value || "").trim();

const sendBrevo = async (
  recipient: string,
  message: ReturnType<typeof renderMembershipWelcomeEmail>,
) => {
  const apiKey = clean(Deno.env.get("BREVO_API_KEY"));
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured.");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: clean(Deno.env.get("BREVO_SENDER_EMAIL")) ||
          "noreply@bendigoflyingclub.com.au",
        name: clean(Deno.env.get("BREVO_SENDER_NAME")) ||
          "Bendigo Flying Club",
      },
      to: [{ email: recipient }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      clean(payload?.message) || `Brevo returned HTTP ${response.status}.`,
    );
  }
  return clean(payload?.messageId) || null;
};

const loadWelcomeBrand = async (
  adminClient: any,
): Promise<MembershipWelcomeBrand> => {
  const { data, error } = await adminClient
    .from("organisation_settings")
    .select("club_name,contact_email,logo_url,student_portal_url")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      "Could not load organisation branding for membership welcome email:",
      error.message,
    );
  }
  return {
    clubName: clean(data?.club_name) || "Bendigo Flying Club",
    contactEmail: clean(data?.contact_email) || null,
    logoUrl: clean(data?.logo_url) || null,
    portalUrl: clean(Deno.env.get("PUBLIC_SITE_URL")) ||
      clean(data?.student_portal_url) ||
      "https://portal.bendigoflyingclub.com.au",
  };
};

const loadWelcomePolicy = async (adminClient: any) => {
  const { data, error } = await adminClient
    .from("membership_settings")
    .select(
      "financial_year_start_month,financial_year_start_day,non_payment_grace_days,renewal_invoice_lead_days",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  const month = Math.min(
    12,
    Math.max(1, Number(data?.financial_year_start_month || 7)),
  );
  const day = Math.min(
    28,
    Math.max(1, Number(data?.financial_year_start_day || 1)),
  );
  return {
    renewalDateLabel: new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, month - 1, day))),
    nonPaymentGraceDays: Number(data?.non_payment_grace_days || 60),
    renewalInvoiceLeadDays: Number(data?.renewal_invoice_lead_days || 30),
  };
};

const requireServiceOrAdmin = async (
  adminClient: any,
  req: Request,
  serviceRoleKey: string,
) => {
  const token = clean(req.headers.get("Authorization")).replace(
    /^Bearer\s+/i,
    "",
  );
  if (token && token === serviceRoleKey) return;
  if (!token) {
    throw Object.assign(new Error("Authentication is required."), {
      status: 401,
    });
  }
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw Object.assign(new Error("Invalid session."), { status: 401 });
  }
  const { data: profile } = await adminClient
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  const { data: roles } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  if (
    profile?.role !== "admin" &&
    !(roles || []).some((item: any) => item.role === "admin")
  ) {
    throw Object.assign(new Error("Admin access is required."), {
      status: 403,
    });
  }
};

const deliver = async (
  adminClient: any,
  input: {
    key: string;
    membershipId?: string;
    userId?: string;
    recipient: string;
    name: string;
    membershipClass: string;
    variant: MembershipWelcomeVariant;
    brand: MembershipWelcomeBrand;
    policy: Awaited<ReturnType<typeof loadWelcomePolicy>>;
    review?: boolean;
  },
) => {
  const { data: existing } = await adminClient
    .from("membership_welcome_email_deliveries")
    .select("id,status,attempts")
    .eq("delivery_key", input.key)
    .maybeSingle();
  if (existing?.status === "sent") {
    return { deliveryKey: input.key, status: "already_sent" };
  }

  let delivery = existing;
  if (existing) {
    const { data, error } = await adminClient
      .from("membership_welcome_email_deliveries")
      .update({
        status: "sending",
        attempts: Number(existing.attempts || 1) + 1,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id,status,attempts")
      .single();
    if (error) throw error;
    delivery = data;
  } else {
    const { data, error } = await adminClient
      .from("membership_welcome_email_deliveries")
      .insert({
        delivery_key: input.key,
        membership_id: input.membershipId || null,
        user_id: input.userId || null,
        recipient_email: input.recipient,
        payment_variant: input.variant,
        is_review: Boolean(input.review),
        status: "sending",
      })
      .select("id,status,attempts")
      .single();
    if (error) {
      const { data: raced } = await adminClient
        .from("membership_welcome_email_deliveries")
        .select("id,status,attempts")
        .eq("delivery_key", input.key)
        .maybeSingle();
      if (raced?.status === "sent" || raced?.status === "sending") {
        return { deliveryKey: input.key, status: "already_claimed" };
      }
      throw error;
    }
    delivery = data;
  }

  try {
    const message = renderMembershipWelcomeEmail({
      name: input.name,
      membershipClass: input.membershipClass,
      variant: input.variant,
      brand: input.brand,
      policy: input.policy,
      review: input.review,
    });
    const messageId = await sendBrevo(input.recipient, message);
    await adminClient
      .from("membership_welcome_email_deliveries")
      .update({
        status: "sent",
        provider_message_id: messageId,
        sent_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
    return {
      deliveryKey: input.key,
      status: "sent",
      subject: message.subject,
      messageId,
    };
  } catch (error) {
    await adminClient
      .from("membership_welcome_email_deliveries")
      .update({
        status: "failed",
        error_message: error instanceof Error
          ? error.message
          : "Email delivery failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);
    throw error;
  }
};

const sendForMembership = async (
  adminClient: any,
  membership: any,
  brand: MembershipWelcomeBrand,
  policy: Awaited<ReturnType<typeof loadWelcomePolicy>>,
) => {
  const [
    { data: member, error: memberError },
    { data: membershipClass, error: classError },
    { data: preference, error: preferenceError },
  ] = await Promise.all([
    adminClient
      .from("users")
      .select("id,name,email")
      .eq("id", membership.user_id)
      .maybeSingle(),
    adminClient
      .from("membership_classes")
      .select("name")
      .eq("id", membership.membership_class_id)
      .maybeSingle(),
    adminClient
      .from("membership_payment_preferences")
      .select("payment_method,auto_renew")
      .eq("user_id", membership.user_id)
      .maybeSingle(),
  ]);
  if (memberError) throw memberError;
  if (classError) throw classError;
  if (preferenceError) throw preferenceError;
  if (!member?.email) {
    throw new Error("The member does not have an email address.");
  }
  const variant: MembershipWelcomeVariant =
    ["becs", "card"].includes(clean(preference?.payment_method)) &&
      preference?.auto_renew === true
      ? "automatic"
      : "manual";
  return deliver(adminClient, {
    key: `membership:${membership.id}`,
    membershipId: membership.id,
    userId: membership.user_id,
    recipient: clean(member.email),
    name: clean(member.name) || "Member",
    membershipClass: clean(membershipClass?.name) || "BFC",
    variant,
    brand,
    policy,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "send-pending");
    const [welcomeBrand, welcomePolicy] = await Promise.all([
      loadWelcomeBrand(adminClient),
      loadWelcomePolicy(adminClient),
    ]);

    if (action === "send-review") {
      const recipient = "lincoln@bbkm.com.au";
      const results = [];
      for (
        const variant of [
          "automatic",
          "manual",
        ] as MembershipWelcomeVariant[]
      ) {
        results.push(
          await deliver(adminClient, {
            key: `review:membership-welcome-v2:${variant}:${recipient}`,
            recipient,
            name: "Lincoln",
            membershipClass: "Full",
            variant,
            brand: welcomeBrand,
            policy: welcomePolicy,
            review: true,
          }),
        );
      }
      return json({ recipient, results });
    }

    await requireServiceOrAdmin(adminClient, req, serviceRoleKey);
    if (action === "send-for-user") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      const { data: membership, error } = await adminClient
        .from("club_memberships")
        .select("id,user_id,membership_class_id,legal_status")
        .eq("user_id", userId)
        .eq("legal_status", "current")
        .maybeSingle();
      if (error) throw error;
      if (!membership) {
        return json({ sent: false, reason: "membership_not_current" });
      }
      return json({
        sent: true,
        result: await sendForMembership(
          adminClient,
          membership,
          welcomeBrand,
          welcomePolicy,
        ),
      });
    }
    if (action !== "send-pending") {
      return json({ error: "Unknown action" }, 400);
    }
    const { data: memberships, error } = await adminClient
      .from("club_memberships")
      .select("id,user_id,membership_class_id,legal_status")
      .eq("legal_status", "current")
      .order("commenced_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    const results = [];
    for (const membership of memberships || []) {
      try {
        results.push(
          await sendForMembership(
            adminClient,
            membership,
            welcomeBrand,
            welcomePolicy,
          ),
        );
      } catch (error) {
        results.push({
          membershipId: membership.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Email failed",
        });
      }
    }
    return json({
      processed: results.length,
      failed: results.filter((item: any) => item.status === "failed").length,
      results,
    });
  } catch (error) {
    const status = typeof (error as any)?.status === "number"
      ? (error as any).status
      : 500;
    console.error("send-membership-welcome-email error:", error);
    return json({
      error: error instanceof Error ? error.message : "Unexpected error",
    }, status);
  }
});
