/**
 * Temporary end-to-end check for the admin -> public plans path.
 *
 * Creates a throwaway plan, confirms it surfaces on the public endpoint, edits
 * it, hides it, then deletes it. Touches no pre-existing plan row and prints no
 * secrets.
 */
const BASE = "http://127.0.0.1:3099";
const TMP_KEY = "zz-verify-tmp";

let failures = 0;
const check = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!pass) failures++;
};

const getPlans = async () => {
  const res = await fetch(`${BASE}/api/plans`, { headers: { Accept: "application/json" } });
  return { status: res.status, body: await res.json() };
};

// 1. Public, unauthenticated read.
const baseline = await getPlans();
check("GET /api/plans is public (no key, no session)", baseline.status === 200, `status ${baseline.status}`);
check("response carries plans array", Array.isArray(baseline.body.plans), `${baseline.body.plans?.length} plans`);
check("response carries feature vocabulary", Array.isArray(baseline.body.featureKeys) && !!baseline.body.featureLabels);
check("source is the database catalogue", baseline.body.source === "catalog", String(baseline.body.source));
check(
  "operator-only fields are not published",
  baseline.body.plans.every((p) => !("usersOnPlan" in p) && !("subscriptionValue" in p) && !("activeSubscriptions" in p))
);
console.log(
  "   baseline published plans:",
  baseline.body.plans.map((p) => `${p.key}=${p.priceMonthly}/${p.monthlyLeadLimit ?? "unlimited"}`).join(", ")
);

// 2. Authenticate as the superadmin console.
const login = await fetch(`${BASE}/api/superadmin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: (process.env.ADMIN_EMAILS || "").split(",")[0].trim(),
    password: process.env.ADMIN_PASSWORD,
    secret: process.env.SUPERADMIN_SECRET,
  }),
});
check("superadmin login succeeds", login.ok, `status ${login.status}`);
if (!login.ok) {
  console.log("Cannot continue without an admin session.");
  process.exit(1);
}
const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

const admin = (path, method, body) =>
  fetch(`${BASE}/api/admin/billing${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });

// Clean up a leftover row from an earlier run, if any.
const existing = (await (await admin("/plans", "GET")).json()).rows.find((r) => r.key === TMP_KEY);
if (existing) await admin(`/plans/${existing.id}`, "DELETE");

// 3. Create a plan and confirm it is published.
const created = await admin("/plans", "POST", {
  key: TMP_KEY,
  name: "Verify Tier",
  description: "Temporary plan created by an automated check.",
  priceMonthly: 123400,
  priceYearly: 1234000,
  currency: "INR",
  monthlyLeadLimit: 4242,
  seats: 7,
  trialDays: 5,
  features: ["whatsappOutreach", "aiInsights"],
  highlight: false,
  isPublic: true,
  isActive: true,
  sortOrder: 99,
});
const createdBody = await created.json();
check("admin can create a plan", created.status === 201, `status ${created.status} ${JSON.stringify(createdBody)}`);
const planId = createdBody.plan?.id;

let after = await getPlans();
let published = after.body.plans.find((p) => p.key === TMP_KEY);
check("new plan appears on the public endpoint", !!published);
check("price is published as saved", published?.priceMonthly === 123400, String(published?.priceMonthly));
check("lead limit is published as saved", published?.monthlyLeadLimit === 4242, String(published?.monthlyLeadLimit));
check("seats are published as saved", published?.seats === 7, String(published?.seats));
check("trial days are published as saved", published?.trialDays === 5, String(published?.trialDays));
check(
  "features are published as saved",
  published?.features.includes("whatsappOutreach") && published?.features.includes("aiInsights"),
  JSON.stringify(published?.features)
);

// 4. Edit it and confirm the edit is reflected immediately.
const patched = await admin(`/plans/${planId}`, "PATCH", {
  name: "Verify Tier Renamed",
  priceMonthly: 555500,
  monthlyLeadLimit: -1,
  highlight: true,
});
check("admin can edit a plan", patched.ok, `status ${patched.status}`);

after = await getPlans();
published = after.body.plans.find((p) => p.key === TMP_KEY);
check("rename is reflected", published?.name === "Verify Tier Renamed", String(published?.name));
check("new price is reflected", published?.priceMonthly === 555500, String(published?.priceMonthly));
check("unlimited (-1) is published as null", published?.monthlyLeadLimit === null, String(published?.monthlyLeadLimit));
check("highlight flag is reflected", published?.highlight === true, String(published?.highlight));

// 5. "Show on public pricing" off must hide it from visitors.
await admin(`/plans/${planId}`, "PATCH", { isPublic: false });
after = await getPlans();
check(
  "isPublic=false hides the plan from visitors",
  !after.body.plans.some((p) => p.key === TMP_KEY)
);

// 6. Deactivating also hides it.
await admin(`/plans/${planId}`, "PATCH", { isPublic: true, isActive: false });
after = await getPlans();
check(
  "isActive=false hides the plan from visitors",
  !after.body.plans.some((p) => p.key === TMP_KEY)
);

// 7. Ordering follows sortOrder.
await admin(`/plans/${planId}`, "PATCH", { isActive: true, sortOrder: 0 });
after = await getPlans();
check("sortOrder drives published order", after.body.plans[0]?.key === TMP_KEY, after.body.plans.map((p) => p.key).join(" < "));

// 8. Clean up.
const deleted = await admin(`/plans/${planId}`, "DELETE");
check("throwaway plan deleted", deleted.ok, `status ${deleted.status}`);

const final = await getPlans();
check("catalogue returned to its original set", final.body.plans.length === baseline.body.plans.length &&
  final.body.plans.every((p, i) => p.key === baseline.body.plans[i].key),
  final.body.plans.map((p) => p.key).join(", "));

// 9. Mutations stay admin-only.
const unauth = await fetch(`${BASE}/api/admin/billing/plans`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "zz-should-not-exist", name: "Nope" }),
});
check("plan writes still require admin auth", unauth.status === 401 || unauth.status === 403, `status ${unauth.status}`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
