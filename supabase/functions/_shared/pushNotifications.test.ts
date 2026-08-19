import { assertEquals } from "jsr:@std/assert@1";
import {
  cleanPushText,
  DEFAULT_PUSH_ICON_URL,
  pushRetryDelaySeconds,
  pushRouteForNotification,
  safePushIconUrl,
  safePushRoute,
  shouldRevokePushSubscription,
} from "./pushNotifications.ts";

Deno.test("push routes preserve safe CRM destinations and reject external routes", () => {
  assertEquals(safePushRoute("/maintenance?tab=defects"), "/maintenance?tab=defects");
  assertEquals(safePushRoute("/duty-clock/app/"), "/duty-clock/app/");
  assertEquals(safePushRoute("https://evil.example/maintenance"), null);
  assertEquals(safePushRoute("//evil.example/maintenance"), null);
});

Deno.test("break reminder push opens the installed Duty Clock", () => {
  assertEquals(
    pushRouteForNotification({ type: "duty_break_reminder", metadata: { route: "/duty" } }),
    "/duty-clock/app/",
  );
});

Deno.test("booking push opens the highlighted calendar day", () => {
  const bookingId = "7b133712-532f-4e2b-b3a3-04ac118e7108";
  assertEquals(
    pushRouteForNotification({ type: "booking_confirmation", metadata: { booking_id: bookingId } }),
    `/calendar?view=day&bookingId=${bookingId}`,
  );
});

Deno.test("training notifications distinguish the member's own profile", () => {
  const userId = "7b133712-532f-4e2b-b3a3-04ac118e7108";
  assertEquals(
    pushRouteForNotification({ type: "training_record", user_id: userId, metadata: { student_id: userId } }),
    "/profile?tab=training",
  );
});

Deno.test("expired subscriptions are revoked and transient failures back off", () => {
  assertEquals(shouldRevokePushSubscription(404), true);
  assertEquals(shouldRevokePushSubscription(410), true);
  assertEquals(shouldRevokePushSubscription(503), false);
  assertEquals(pushRetryDelaySeconds(1), 30);
  assertEquals(pushRetryDelaySeconds(4), 240);
  assertEquals(pushRetryDelaySeconds(20), 3600);
});

Deno.test("push text is compact and bounded", () => {
  assertEquals(cleanPushText("  Booking   confirmed \n now ", 18), "Booking confirmed");
});

Deno.test("push icons accept secure company logos and reject unsafe URLs", () => {
  assertEquals(safePushIconUrl("https://cdn.example.com/company-logo.png"), "https://cdn.example.com/company-logo.png");
  assertEquals(safePushIconUrl("javascript:alert(1)"), DEFAULT_PUSH_ICON_URL);
  assertEquals(safePushIconUrl("http://cdn.example.com/company-logo.png"), DEFAULT_PUSH_ICON_URL);
  assertEquals(safePushIconUrl(null), DEFAULT_PUSH_ICON_URL);
});
