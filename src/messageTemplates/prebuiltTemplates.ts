/**
 * Pre-built starter template library.
 *
 * These are fully-customizable starting points, NOT locked content. Every field
 * is editable once the user clones one into their workspace. They are served
 * read-only via GET /api/message-templates/prebuilt and cloned on use.
 *
 * Wording here is intentionally generic and uses variables so a cloned template
 * personalises itself. Nothing is industry-locked beyond the example copy.
 */

import type {
  MessageTemplatePayload,
  TemplateCategory,
  TemplateVariable,
} from "./types";
import { systemVariablesAsTemplateVars } from "./variables";

export interface PrebuiltTemplate {
  /** Stable slug for the starter (not a DB id). */
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  language: string;
  tags: string[];
  payload: MessageTemplatePayload;
}

/** Pick a subset of system variables plus any extra custom ones for a starter. */
function varsFor(keys: string[], extra: TemplateVariable[] = []): TemplateVariable[] {
  const system = systemVariablesAsTemplateVars().filter((v) => keys.includes(v.key));
  return [...system, ...extra];
}

/** Build a payload with sensible defaults so starters stay terse to define. */
function payload(parts: {
  headerText?: string;
  body: string;
  footer?: string;
  actions?: { type: "url" | "phone" | "whatsapp_link" | "custom_url"; label: string; value: string }[];
  quickReplies?: string[];
  variables: TemplateVariable[];
}): MessageTemplatePayload {
  return {
    header: parts.headerText
      ? { type: "text", text: parts.headerText }
      : { type: "none" },
    body: { text: parts.body },
    footer: parts.footer ? { enabled: true, text: parts.footer } : { enabled: false, text: "" },
    actions: (parts.actions || []).map((a, i) => ({ id: `a${i + 1}`, ...a })),
    quickReplies: (parts.quickReplies || []).map((display, i) => ({
      id: `qr${i + 1}`,
      display,
      payload: display.toUpperCase().replace(/\s+/g, "_"),
    })),
    variables: parts.variables,
    settings: { deliveryMethod: "web", personalization: true },
  };
}

export const PREBUILT_TEMPLATES: readonly PrebuiltTemplate[] = [
  {
    slug: "dental-clinic-outreach",
    name: "Dental Clinic AI Outreach",
    description: "Introduce AI appointment automation to dental clinics.",
    category: "marketing",
    language: "en",
    tags: ["Dental", "Lead Generation", "Appointment"],
    payload: payload({
      headerText: "Smarter patient enquiries",
      body: "Hi {{first_name}} 👋\n\nManaging patient calls and WhatsApp enquiries while treating patients can be difficult.\n\nOur AI WhatsApp assistant answers common questions, captures leads and helps patients book appointments 24/7.\n\nWould you like to see how it can work for {{company_name}}?",
      footer: "Reply STOP to opt out.",
      actions: [
        { type: "url", label: "Book Free Demo", value: "https://example.com/demo" },
        { type: "url", label: "Visit Website", value: "https://example.com" },
      ],
      quickReplies: ["Interested", "Send Details", "Not Now"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "real-estate-followup",
    name: "Real Estate Lead Follow-up",
    description: "Follow up with property enquiry leads.",
    category: "sales",
    language: "en",
    tags: ["Real Estate", "Follow-up"],
    payload: payload({
      body: "Hi {{first_name}}, following up on your interest in properties around {{city}}.\n\nI have a few options that match what you're looking for. Would you like me to share the details?",
      actions: [{ type: "whatsapp_link", label: "Chat With Us", value: "https://wa.me/919876543210" }],
      quickReplies: ["Yes, share", "Call me", "Not now"],
      variables: varsFor(["first_name", "city"]),
    }),
  },
  {
    slug: "web-development-offer",
    name: "Website Development Services",
    description: "Promote website development services to businesses without a strong web presence.",
    category: "marketing",
    language: "en",
    tags: ["Web Development", "Digital"],
    payload: payload({
      headerText: "Special Offer",
      body: "Hi {{first_name}}, we have a special website development offer for {{company_name}}.\n\nA modern, mobile-friendly website that brings you more customers. Interested in a quick look at what we can build?",
      footer: "SP Digitech Solutions",
      actions: [{ type: "url", label: "View Our Work", value: "https://example.com/portfolio" }],
      quickReplies: ["Interested", "Get Quote"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "digital-marketing-outreach",
    name: "Digital Marketing Outreach",
    description: "Offer digital marketing services to local businesses.",
    category: "marketing",
    language: "en",
    tags: ["Digital Marketing", "Lead Generation"],
    payload: payload({
      body: "Hi {{first_name}} 👋\n\nIs {{company_name}} getting enough customers from Google and social media?\n\nWe help local businesses in {{city}} grow with targeted digital marketing. Want to see a free growth plan?",
      actions: [{ type: "url", label: "Get Free Plan", value: "https://example.com/plan" }],
      quickReplies: ["Yes please", "Tell me more", "Not interested"],
      variables: varsFor(["first_name", "company_name", "city"]),
    }),
  },
  {
    slug: "restaurant-promotion",
    name: "Restaurant Promotion",
    description: "Promote offers and new menu items to restaurant customers.",
    category: "marketing",
    language: "en",
    tags: ["Restaurant", "Offer", "Festive"],
    payload: payload({
      headerText: "{{offer}} this week!",
      body: "Hi {{first_name}} 🍽️\n\nWe've got something special at our place this week: {{offer}}.\n\nCome enjoy great food with family and friends. Book your table now!",
      footer: "See you soon!",
      actions: [{ type: "phone", label: "Call to Book", value: "+919876543210" }],
      quickReplies: ["Book a table", "See menu"],
      variables: varsFor(["first_name", "offer"]),
    }),
  },
  {
    slug: "salon-appointment",
    name: "Salon Appointment Promotion",
    description: "Invite customers to book salon appointments.",
    category: "marketing",
    language: "en",
    tags: ["Salon", "Appointment"],
    payload: payload({
      body: "Hi {{first_name}} 💇\n\nTime to treat yourself! Book your next appointment at our salon and enjoy {{discount}} on your favourite services.\n\nShall I reserve a slot for you?",
      actions: [{ type: "whatsapp_link", label: "Book Now", value: "https://wa.me/919876543210" }],
      quickReplies: ["Book appointment", "View services"],
      variables: varsFor(["first_name", "discount"]),
    }),
  },
  {
    slug: "gym-membership",
    name: "Gym Membership Offer",
    description: "Promote gym memberships and fitness plans.",
    category: "marketing",
    language: "en",
    tags: ["Gym", "Fitness", "Offer"],
    payload: payload({
      headerText: "Start your fitness journey",
      body: "Hi {{first_name}} 💪\n\nReady to get fit in {{city}}? Join now and get {{offer}} on your first membership.\n\nOur trainers will help you reach your goals. Want to come in for a free trial session?",
      actions: [{ type: "url", label: "Claim Offer", value: "https://example.com/join" }],
      quickReplies: ["Free trial", "Membership plans", "Not now"],
      variables: varsFor(["first_name", "city", "offer"]),
    }),
  },
  {
    slug: "healthcare-appointment",
    name: "Healthcare Appointment",
    description: "Invite patients to book healthcare appointments.",
    category: "utility",
    language: "en",
    tags: ["Healthcare", "Appointment"],
    payload: payload({
      body: "Hi {{first_name}},\n\nIt's time for your check-up at {{company_name}}. Booking early means you get your preferred time slot.\n\nWould you like to schedule an appointment?",
      footer: "Your health matters to us.",
      actions: [{ type: "phone", label: "Call to Book", value: "+919876543210" }],
      quickReplies: ["Book now", "Call me back"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "education-course-promotion",
    name: "Education / Course Promotion",
    description: "Promote courses and educational programs.",
    category: "marketing",
    language: "en",
    tags: ["Education", "Course", "Webinar"],
    payload: payload({
      headerText: "Enroll today",
      body: "Hi {{first_name}} 🎓\n\nAdmissions are open for our latest programs. Build in-demand skills and advance your career.\n\nWant to know more about the courses, fees and schedule?",
      actions: [{ type: "url", label: "View Courses", value: "https://example.com/courses" }],
      quickReplies: ["Course details", "Fees", "Register Now"],
      variables: varsFor(["first_name"]),
    }),
  },
  {
    slug: "ecommerce-offer",
    name: "E-commerce Offer",
    description: "Announce discounts and sales to online shoppers.",
    category: "marketing",
    language: "en",
    tags: ["E-commerce", "Offer", "Discount"],
    payload: payload({
      headerText: "{{discount}} OFF — limited time",
      body: "Hi {{first_name}} 🛍️\n\nOur biggest sale is live! Get {{discount}} off on your favourite products.\n\nHurry, the offer ends soon. Shop now and save big!",
      footer: "Reply STOP to opt out.",
      actions: [{ type: "url", label: "Shop Now", value: "https://example.com/sale" }],
      quickReplies: ["Shop now", "View offers"],
      variables: varsFor(["first_name", "discount"]),
    }),
  },
  {
    slug: "payment-reminder",
    name: "Payment Reminder",
    description: "Remind customers about a pending payment.",
    category: "utility",
    language: "en",
    tags: ["Payment", "Reminder", "Invoice"],
    payload: payload({
      body: "Hi {{first_name}},\n\nThis is a friendly reminder that your payment to {{company_name}} is due. Please complete it at your earliest convenience to avoid any interruption.\n\nLet us know if you have any questions.",
      actions: [{ type: "url", label: "Pay Now", value: "https://example.com/pay" }],
      quickReplies: ["Already paid", "Need help"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "order-confirmation",
    name: "Order Confirmation",
    description: "Confirm a customer's order.",
    category: "utility",
    language: "en",
    tags: ["Order", "Confirmation"],
    payload: payload({
      body: "Hi {{first_name}} ✅\n\nThank you for your order with {{company_name}}! We've received it and are getting it ready.\n\nWe'll notify you as soon as it ships.",
      footer: "Thanks for shopping with us.",
      quickReplies: ["Track order", "Contact support"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "appointment-reminder",
    name: "Appointment Reminder",
    description: "Remind a contact of an upcoming appointment.",
    category: "utility",
    language: "en",
    tags: ["Appointment", "Reminder"],
    payload: payload({
      body: "Hi {{first_name}},\n\nReminder: you have an appointment with {{company_name}} on {{appointment_date}} at {{appointment_time}}.\n\nPlease reply to confirm, or let us know if you need to reschedule.",
      quickReplies: ["Confirm", "Reschedule", "Cancel"],
      variables: varsFor(["first_name", "company_name", "appointment_date", "appointment_time"]),
    }),
  },
  {
    slug: "customer-feedback",
    name: "Customer Feedback Request",
    description: "Ask customers for feedback after a service.",
    category: "support",
    language: "en",
    tags: ["Feedback", "Survey", "Support"],
    payload: payload({
      body: "Hi {{first_name}} 🙏\n\nThank you for choosing {{company_name}}! We'd love to hear about your experience.\n\nIt only takes a minute and helps us serve you better.",
      actions: [{ type: "url", label: "Give Feedback", value: "https://example.com/feedback" }],
      quickReplies: ["Great!", "Could be better", "Had an issue"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "welcome-message",
    name: "Welcome Message",
    description: "Welcome a new customer or subscriber.",
    category: "support",
    language: "en",
    tags: ["Welcome", "Onboarding"],
    payload: payload({
      headerText: "Welcome aboard!",
      body: "Hi {{first_name}} 👋\n\nWelcome to {{company_name}}! We're thrilled to have you.\n\nIf you ever have questions, just reply to this message — we're here to help.",
      footer: "Glad to have you with us.",
      quickReplies: ["Get started", "Talk to support"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "lead-followup",
    name: "Lead Follow-up",
    description: "Follow up with a lead who hasn't responded.",
    category: "sales",
    language: "en",
    tags: ["Follow-up", "Sales"],
    payload: payload({
      body: "Hi {{first_name}}, just circling back on my earlier message.\n\nI'd still love to show how we can help {{company_name}}. Is now a good time, or should I check back later?",
      quickReplies: ["Let's talk", "Check back later", "Not interested"],
      variables: varsFor(["first_name", "company_name"]),
    }),
  },
  {
    slug: "reactivation-campaign",
    name: "Reactivation Campaign",
    description: "Re-engage dormant customers or leads.",
    category: "marketing",
    language: "en",
    tags: ["Reactivation", "Win-back"],
    payload: payload({
      headerText: "We miss you!",
      body: "Hi {{first_name}},\n\nIt's been a while! We've got new offers and updates at {{company_name}} we think you'll love.\n\nHere's {{offer}} to welcome you back. Shall we catch you up?",
      actions: [{ type: "url", label: "See What's New", value: "https://example.com/new" }],
      quickReplies: ["Show me", "No thanks"],
      variables: varsFor(["first_name", "company_name", "offer"]),
    }),
  },
];

/** Return the full starter library (read-only, cloned on use). */
export function getPrebuiltTemplates(): readonly PrebuiltTemplate[] {
  return PREBUILT_TEMPLATES;
}

/** Look up a single starter by slug. */
export function getPrebuiltTemplate(slug: string): PrebuiltTemplate | undefined {
  return PREBUILT_TEMPLATES.find((t) => t.slug === slug);
}
