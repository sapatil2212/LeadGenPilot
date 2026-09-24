/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Business profile, catalogue and AI-assisted extraction.
 *
 * This is the data every later phase reads from: campaign copy needs the products
 * and the differentiators, targeting needs the customer types. So the panel leads
 * with a completeness meter rather than a form — the useful question is not "is
 * this valid" but "is there enough here for the AI to work from", and the answer
 * is a proportion.
 *
 * The extraction tab never writes without being asked. That is the product's
 * approval principle, and it is visible in the UI: the model's output is shown as
 * a reviewable diff-like summary with an explicit Apply, because these fields
 * become factual claims in messages sent under the customer's own name.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Briefcase,
  Building2,
  Check,
  FileText,
  Library,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import {
  api,
  type BusinessProfileView,
  type ProductView,
  type ServiceView,
} from "../ui/api";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNotice,
  Field,
  Meter,
  Notice,
  Spinner,
  SubTabs,
  TagInput,
  TextArea,
  TextInput,
  formatAgo,
  formatBytes,
  tokens,
  useAction,
  useAsync,
  type Themed,
} from "../ui/primitives";

type Tab = "learn" | "profile" | "products" | "services" | "knowledge";

const KnowledgePanel = React.lazy(() => import("./KnowledgePanel"));

type BusinessPanelProps = Themed & { initialTab?: "learn" | "knowledge" };

export default function BusinessPanel({ isLight, initialTab = "learn" }: BusinessPanelProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const products = useAsync<ProductView[]>(() => api.get("/api/business/products"));
  const services = useAsync<ServiceView[]>(() => api.get("/api/business/services"));

  return (
    <div className="space-y-5">
      <SubTabs<Tab>
        isLight={isLight}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "learn", label: "Upload & teach AI", icon: Wand2 },
          { id: "profile", label: "Company profile", icon: Building2 },
          { id: "products", label: "Products", icon: Boxes, count: products.data?.length },
          { id: "services", label: "Services", icon: Briefcase, count: services.data?.length },
          { id: "knowledge", label: "Knowledge library", icon: Library },
        ]}
      />

      {tab === "learn" && (
        <LearnTab
          isLight={isLight}
          onApplied={() => {
            products.reload();
            services.reload();
          }}
        />
      )}
      {tab === "profile" && <ProfileTab isLight={isLight} />}
      {tab === "products" && <ProductsTab isLight={isLight} state={products} />}
      {tab === "services" && <ServicesTab isLight={isLight} state={services} />}
      {tab === "knowledge" && (
        <React.Suspense fallback={<Spinner isLight={isLight} label="Loading knowledge library…" />}>
          <KnowledgePanel isLight={isLight} />
        </React.Suspense>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Company profile
// ─────────────────────────────────────────────────────────────────────────────

const LIST_FIELDS = [
  {
    key: "targetCustomerTypes" as const,
    label: "Customer types you sell to",
    hint: "The kinds of business that buy from you, e.g. Multispecialty Hospital, Dealer.",
  },
  {
    key: "locationsServed" as const,
    label: "Locations you serve",
    hint: "Cities, states or countries you can actually deliver to.",
  },
  {
    key: "uniqueSellingPoints" as const,
    label: "What makes you different",
    hint: "Used verbatim in outreach, so keep each point true and specific.",
  },
  {
    key: "decisionMakerRoles" as const,
    label: "Who you need to reach",
    hint: "Job titles that sign off a purchase, e.g. Procurement Manager.",
  },
  {
    key: "targetIndustries" as const,
    label: "Industries you sell into",
    hint: "Broader than a category — used when judging whether a lead is the right kind of customer.",
  },
  {
    key: "certifications" as const,
    label: "Certifications",
    hint: "Only ones you actually hold. The AI is instructed never to invent these.",
  },
];

function ProfileTab({ isLight }: Themed) {
  const t = tokens(isLight);
  const state = useAsync<BusinessProfileView>(() => api.get("/api/business/profile"));
  const save = useAction();
  const [draft, setDraft] = useState<BusinessProfileView | null>(null);

  const profile = draft ?? state.data;
  const dirty = draft !== null;

  const edit = useCallback(
    (patch: Partial<BusinessProfileView>) => {
      setDraft((current) => ({ ...(current ?? state.data!), ...patch }));
    },
    [state.data]
  );

  if (state.loading) return <Spinner isLight={isLight} label="Loading your business profile…" />;
  if (state.error) return <ErrorNotice isLight={isLight} error={state.error} />;
  if (!profile) return null;

  const onSave = async () => {
    const saved = await save.run(
      () => api.put<BusinessProfileView>("/api/business/profile", draft),
      "Profile saved."
    );
    if (saved) {
      state.setData(saved);
      setDraft(null);
    }
  };

  return (
    <div className="space-y-5">
      <ErrorNotice isLight={isLight} error={save.error} onDismiss={save.clearError} />
      {save.done && (
        <Notice isLight={isLight} tone="success" onDismiss={save.clearDone}>
          {save.done}
        </Notice>
      )}

      <Card
        isLight={isLight}
        title="How complete is this?"
        subtitle="Everything downstream — targeting, scoring, campaign copy — reads from here."
        icon={Sparkles}
      >
        <div className="grid md:grid-cols-3 gap-5 items-center">
          <div className="md:col-span-2">
            <Meter
              isLight={isLight}
              value={profile.completeness}
              max={100}
              label="Profile completeness"
              tone={profile.completeness >= 70 ? "emerald" : profile.completeness >= 40 ? "amber" : "indigo"}
            />
            <p className={`text-[11px] mt-2 leading-relaxed ${t.muted}`}>
              Weighted towards the fields later phases actually need: who you sell to, where you
              operate, and what makes you different. A description alone is not enough for the AI to
              target or write with.
            </p>
          </div>
          <div className={`border rounded-xl p-3 ${t.inset}`}>
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${t.muted}`}>
              Last AI extraction
            </div>
            <div className={`text-xs mt-1 ${t.body}`}>{formatAgo(profile.lastExtractedAt)}</div>
            {profile.aiConfidence !== null && (
              <div className={`text-[11px] mt-1.5 ${t.faint}`}>
                Model confidence {Math.round(profile.aiConfidence * 100)}%
              </div>
            )}
          </div>
        </div>

        {profile.missingInformation.length > 0 && (
          <div className="mt-4">
            <Notice isLight={isLight} tone="info" title="The AI asked for these">
              <ul className="space-y-0.5 mt-1">
                {profile.missingInformation.map((question, i) => (
                  <li key={i}>• {question}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
      </Card>

      <Card
        isLight={isLight}
        title="Company"
        icon={Building2}
        actions={
          <>
            {dirty && (
              <Button isLight={isLight} variant="ghost" icon={X} onClick={() => setDraft(null)}>
                Discard
              </Button>
            )}
            <Button
              isLight={isLight}
              variant="primary"
              icon={Check}
              busy={save.busy}
              disabled={!dirty}
              onClick={onSave}
            >
              {dirty ? "Save changes" : "Saved"}
            </Button>
          </>
        }
      >
        <div className="grid md:grid-cols-2 gap-4">
          <Field isLight={isLight} label="Business name">
            <TextInput
              isLight={isLight}
              value={profile.businessName ?? ""}
              onChange={(e) => edit({ businessName: e.target.value })}
              placeholder="Brightwave Instruments"
            />
          </Field>
          <Field
            isLight={isLight}
            label="Industry"
            hint="Free text on purpose — any category is valid."
          >
            <TextInput
              isLight={isLight}
              value={profile.industry ?? ""}
              onChange={(e) => edit({ industry: e.target.value })}
              placeholder="Medical Equipment Manufacturing"
            />
          </Field>
          <Field isLight={isLight} label="Business type">
            <TextInput
              isLight={isLight}
              value={profile.businessType ?? ""}
              onChange={(e) => edit({ businessType: e.target.value })}
              placeholder="Manufacturer"
            />
          </Field>
          <Field isLight={isLight} label="Website">
            <TextInput
              isLight={isLight}
              value={profile.website ?? ""}
              onChange={(e) => edit({ website: e.target.value })}
              placeholder="https://example.com"
            />
          </Field>
          <Field
            isLight={isLight}
            label="What the business does"
            hint="Two or three sentences. This is the first thing the AI reads."
            className="md:col-span-2"
          >
            <TextArea
              isLight={isLight}
              rows={3}
              value={profile.description ?? ""}
              onChange={(e) => edit({ description: e.target.value })}
              placeholder="We manufacture autoclaves and sterilisation equipment for hospitals and dental clinics."
            />
          </Field>
          <Field isLight={isLight} label="City">
            <TextInput
              isLight={isLight}
              value={profile.city ?? ""}
              onChange={(e) => edit({ city: e.target.value })}
            />
          </Field>
          <Field isLight={isLight} label="State">
            <TextInput
              isLight={isLight}
              value={profile.state ?? ""}
              onChange={(e) => edit({ state: e.target.value })}
            />
          </Field>
          <Field isLight={isLight} label="Country">
            <TextInput
              isLight={isLight}
              value={profile.country ?? ""}
              onChange={(e) => edit({ country: e.target.value })}
            />
          </Field>
          <Field isLight={isLight} label="Contact email">
            <TextInput
              isLight={isLight}
              value={profile.contactEmail ?? ""}
              onChange={(e) => edit({ contactEmail: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card isLight={isLight} title="Market and positioning" icon={Sparkles}>
        <div className="grid md:grid-cols-2 gap-4">
          {LIST_FIELDS.map((field) => (
            <React.Fragment key={field.key}>
              <Field isLight={isLight} label={field.label} hint={field.hint}>
                <TagInput
                  isLight={isLight}
                  values={profile[field.key]}
                  onChange={(values) =>
                    edit({ [field.key]: values } as Partial<BusinessProfileView>)
                  }
                  placeholder="Type and press Enter"
                />
              </Field>
            </React.Fragment>
          ))}
          <Field
            isLight={isLight}
            label="Brand voice"
            hint="Applied to generated copy, e.g. formal, technical, warm."
          >
            <TextInput
              isLight={isLight}
              value={profile.brandVoice ?? ""}
              onChange={(e) => edit({ brandVoice: e.target.value })}
              placeholder="formal, technical"
            />
          </Field>
          <Field isLight={isLight} label="Sales objectives">
            <TextArea
              isLight={isLight}
              rows={2}
              value={profile.salesObjectives ?? ""}
              onChange={(e) => edit({ salesObjectives: e.target.value })}
              placeholder="Book 20 demos a month with hospital procurement teams."
            />
          </Field>
        </div>

        {dirty && (
          <div className="mt-5 flex justify-end">
            <Button isLight={isLight} variant="primary" icon={Check} busy={save.busy} onClick={onSave}>
              Save changes
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogueDraft {
  id?: string;
  name: string;
  category: string;
  description: string;
  priceRange: string;
  keyFeatures: string[];
  idealFor: string[];
}

const emptyDraft: CatalogueDraft = {
  name: "",
  category: "",
  description: "",
  priceRange: "",
  keyFeatures: [],
  idealFor: [],
};

function ProductsTab({
  isLight,
  state,
}: Themed & { state: ReturnType<typeof useAsync<ProductView[]>> }) {
  return (
    <CatalogueTab
      isLight={isLight}
      state={state}
      kind="product"
      endpoint="/api/business/products"
      withFeatures
      icon={Boxes}
      title="Products"
      subtitle="Drives product-to-lead fit and gives campaign copy something concrete to offer."
    />
  );
}

function ServicesTab({
  isLight,
  state,
}: Themed & { state: ReturnType<typeof useAsync<ServiceView[]>> }) {
  return (
    <CatalogueTab
      isLight={isLight}
      state={state}
      kind="service"
      endpoint="/api/business/services"
      icon={Briefcase}
      title="Services"
      subtitle="Anything you deliver rather than ship."
    />
  );
}

function CatalogueTab({
  isLight,
  state,
  kind,
  endpoint,
  withFeatures = false,
  icon,
  title,
  subtitle,
}: Themed & {
  state: ReturnType<typeof useAsync<any[]>>;
  kind: string;
  endpoint: string;
  withFeatures?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  const t = tokens(isLight);
  const action = useAction();
  const [draft, setDraft] = useState<CatalogueDraft | null>(null);

  const submit = async () => {
    if (!draft || !draft.name.trim()) return;
    const body: Record<string, unknown> = {
      name: draft.name,
      category: draft.category || null,
      description: draft.description || null,
      priceRange: draft.priceRange || null,
      idealFor: draft.idealFor,
      ...(withFeatures ? { keyFeatures: draft.keyFeatures } : {}),
    };
    const saved = draft.id
      ? await action.run(() => api.patch(`${endpoint}/${draft.id}`, body), `${title} updated.`)
      : await action.run(() => api.post(endpoint, body), `${title} added.`);
    if (saved) {
      setDraft(null);
      state.reload();
    }
  };

  const remove = async (id: string) => {
    const ok = await action.run(() => api.del(`${endpoint}/${id}`));
    if (ok) state.reload();
  };

  return (
    <div className="space-y-5">
      <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />

      <Card
        isLight={isLight}
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <Button
            isLight={isLight}
            variant="primary"
            icon={Plus}
            onClick={() => setDraft({ ...emptyDraft })}
          >
            Add {kind}
          </Button>
        }
      >
        {draft && (
          <div className={`border rounded-xl p-4 mb-4 ${t.inset}`}>
            <div className="grid md:grid-cols-2 gap-4">
              <Field isLight={isLight} label="Name">
                <TextInput
                  isLight={isLight}
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={kind === "product" ? "PX-100 Autoclave" : "Annual maintenance contract"}
                />
              </Field>
              <Field isLight={isLight} label="Category">
                <TextInput
                  isLight={isLight}
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
              </Field>
              <Field isLight={isLight} label="Description" className="md:col-span-2">
                <TextArea
                  isLight={isLight}
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              {withFeatures && (
                <Field isLight={isLight} label="Key features">
                  <TagInput
                    isLight={isLight}
                    values={draft.keyFeatures}
                    onChange={(keyFeatures) => setDraft({ ...draft, keyFeatures })}
                    placeholder="18 litre chamber"
                  />
                </Field>
              )}
              <Field isLight={isLight} label="Ideal for">
                <TagInput
                  isLight={isLight}
                  values={draft.idealFor}
                  onChange={(idealFor) => setDraft({ ...draft, idealFor })}
                  placeholder="Dental clinics"
                />
              </Field>
              <Field
                isLight={isLight}
                label="Price positioning"
                hint="Free text. 'On application' and 'from ₹8L' are as valid as a number, and the AI will never invent one."
                className="md:col-span-2"
              >
                <TextInput
                  isLight={isLight}
                  value={draft.priceRange}
                  onChange={(e) => setDraft({ ...draft, priceRange: e.target.value })}
                  placeholder="On application"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button isLight={isLight} variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                isLight={isLight}
                variant="primary"
                icon={Check}
                busy={action.busy}
                disabled={!draft.name.trim()}
                onClick={submit}
              >
                {draft.id ? "Save" : `Add ${kind}`}
              </Button>
            </div>
          </div>
        )}

        {state.loading ? (
          <Spinner isLight={isLight} />
        ) : state.error ? (
          <ErrorNotice isLight={isLight} error={state.error} />
        ) : (state.data ?? []).length === 0 ? (
          <EmptyState
            isLight={isLight}
            icon={icon}
            title={`No ${kind}s yet`}
            action={
              !draft && (
                <Button isLight={isLight} variant="primary" icon={Plus} onClick={() => setDraft({ ...emptyDraft })}>
                  Add your first {kind}
                </Button>
              )
            }
          >
            Campaign copy and lead fit both read from this list. An empty catalogue means the AI has
            nothing specific to offer a prospect.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {(state.data ?? []).map((item: any) => (
              <div
                key={item.id}
                className={`border rounded-xl px-4 py-3 flex items-start justify-between gap-4 ${t.inset}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${t.heading}`}>{item.name}</span>
                    {item.category && <Badge isLight={isLight}>{item.category}</Badge>}
                    {item.priceRange && (
                      <Badge isLight={isLight} tone="info">
                        {item.priceRange}
                      </Badge>
                    )}
                  </div>
                  {item.description && (
                    <p className={`text-xs mt-1 leading-relaxed ${t.muted}`}>{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(item.keyFeatures ?? []).map((f: string) => (
                      <span key={f} className={`text-[10px] px-1.5 py-0.5 rounded ${t.chip}`}>
                        {f}
                      </span>
                    ))}
                    {(item.idealFor ?? []).map((f: string) => (
                      <span
                        key={f}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/10 text-indigo-300"
                        }`}
                      >
                        for {f}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    isLight={isLight}
                    variant="ghost"
                    icon={Pencil}
                    onClick={() =>
                      setDraft({
                        id: item.id,
                        name: item.name,
                        category: item.category ?? "",
                        description: item.description ?? "",
                        priceRange: item.priceRange ?? "",
                        keyFeatures: item.keyFeatures ?? [],
                        idealFor: item.idealFor ?? [],
                      })
                    }
                  >
                    Edit
                  </Button>
                  <ConfirmButton
                    isLight={isLight}
                    icon={Trash2}
                    label="Delete"
                    onConfirm={() => remove(item.id)}
                    busy={action.busy}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI extraction
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractedFields {
  businessName: string | null;
  industry: string | null;
  businessType: string | null;
  description: string | null;
  products: { name: string; category: string | null; description: string | null }[];
  services: { name: string; description: string | null }[];
  targetCustomerTypes: string[];
  targetIndustries: string[];
  locationsServed: string[];
  uniqueSellingPoints: string[];
  certifications: string[];
  decisionMakerRoles: string[];
  brandVoice: string | null;
  missingInformation: string[];
  confidence: number;
}

interface ExtractionResult {
  /** Null only when a file was read but held no usable text. */
  extracted: ExtractedFields | null;
  applied: boolean;
  createdProducts: number;
  createdServices: number;
  /** Present on the file path: where the text came from and how it was read. */
  fileName?: string;
  kind?: "document" | "spreadsheet" | "image";
  charCount?: number;
  sourceText?: string;
  warning?: string;
}

/** Human label for how a file was read, shown next to the result. */
const KIND_LABEL: Record<string, string> = {
  document: "Read as a document",
  spreadsheet: "Read as a spreadsheet",
  image: "Read with AI vision",
};

/** 20 MB, mirroring the server's upload cap. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function LearnTab({ isLight, onApplied }: Themed & { onApplied: () => void }) {
  const t = tokens(isLight);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extract = useAction(); // read pasted text
  const readFile = useAction(); // read an uploaded file
  const apply = useAction(); // write the reviewed result to the profile
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const tooShort = text.trim().length < 40;

  const readText = async () => {
    const outcome = await extract.run<ExtractionResult>(() =>
      api.post("/api/business/extract", { text, apply: false })
    );
    if (outcome) {
      setResult(outcome);
      setSource("pasted text");
    }
  };

  const submitFile = async (file: File) => {
    setSizeError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setSizeError(`"${file.name}" is ${formatBytes(file.size)}. Files must be ${formatBytes(MAX_UPLOAD_BYTES)} or smaller.`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("apply", "false");
    const outcome = await readFile.run<ExtractionResult>(() =>
      api.upload<ExtractionResult>("/api/business/extract-file", form)
    );
    if (outcome) {
      setResult(outcome);
      setSource(outcome.fileName ?? file.name);
    }
  };

  const applyNow = async () => {
    const reviewed = result?.extracted;
    if (!reviewed) return;
    const outcome = await apply.run<ExtractionResult>(
      () => api.post("/api/business/apply-extraction", { extracted: reviewed }),
      "Applied to your profile."
    );
    if (outcome) {
      // Keep the reviewed reading on screen; only fold in the write outcome.
      setResult((prev) =>
        prev
          ? {
              ...prev,
              applied: true,
              createdProducts: outcome.createdProducts,
              createdServices: outcome.createdServices,
            }
          : outcome
      );
      onApplied();
    }
  };

  const onPick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) submitFile(file);
  };

  const extracted = result?.extracted ?? null;

  return (
    <div className="space-y-5">
      <Card
        isLight={isLight}
        title="Upload a file and let the AI read it"
        subtitle="Drop in a brochure, company profile, price list, deck or even a photo. The AI pulls out your company details, products and services so you don't type them in."
        icon={Upload}
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onPick(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragging
              ? isLight
                ? "border-indigo-400 bg-indigo-50"
                : "border-indigo-400 bg-indigo-500/10"
              : isLight
                ? "border-slate-300 hover:border-slate-400 bg-slate-50"
                : "border-white/15 hover:border-white/25 bg-white/[0.02]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = "";
            }}
          />
          {readFile.busy ? (
            <div className="flex flex-col items-center gap-2">
              <Spinner isLight={isLight} label="Reading your file…" />
              <p className={`text-[11px] ${t.faint}`}>
                Large PDFs and images can take a moment.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  isLight ? "bg-indigo-100 text-indigo-600" : "bg-indigo-500/15 text-indigo-300"
                }`}
              >
                <Upload className="w-5 h-5" />
              </div>
              <div className={`text-sm font-semibold ${t.heading}`}>
                Drop a file here, or click to browse
              </div>
              <p className={`text-[11px] leading-relaxed max-w-md ${t.muted}`}>
                PDF, Word, PowerPoint, Excel, CSV, text or an image (JPG, PNG). Up to{" "}
                {formatBytes(MAX_UPLOAD_BYTES)}. Scanned PDFs and photos are read with AI vision.
              </p>
            </div>
          )}
        </div>

        {sizeError && (
          <div className="mt-3">
            <Notice isLight={isLight} tone="warn" onDismiss={() => setSizeError(null)}>
              {sizeError}
            </Notice>
          </div>
        )}
        <ErrorNotice isLight={isLight} error={readFile.error} onDismiss={readFile.clearError} />
      </Card>

      <Card
        isLight={isLight}
        title="Or paste text about your business"
        subtitle="An about page, a pitch, anything descriptive. Handy when you don't have a file."
        icon={Wand2}
      >
        <Notice isLight={isLight} tone="info" title="Nothing is saved until you say so">
          The AI's reading is shown for review first. When you apply it, fields you have already
          filled in are never overwritten and lists are merged, not replaced — a brochure's marketing
          copy should not silently replace something you wrote by hand.
        </Notice>

        <div className="mt-4">
          <Field
            isLight={isLight}
            label="Text about the business"
            hint={`${text.trim().length} characters. At least 40 needed.`}
          >
            <TextArea
              isLight={isLight}
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Brightwave Instruments manufactures autoclaves and sterilisation equipment for hospitals and dental clinics across western India. Our PX-100 holds 18 litres and completes a cycle in 22 minutes, with a 36-month warranty…"
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4">
          <Button
            isLight={isLight}
            icon={Sparkles}
            busy={extract.busy}
            disabled={tooShort}
            onClick={readText}
          >
            Read it
          </Button>
        </div>

        <ErrorNotice isLight={isLight} error={extract.error} onDismiss={extract.clearError} />
      </Card>

      {result && !extracted && result.warning && (
        <Notice isLight={isLight} tone="warn" title="Nothing to read">
          {result.warning}
        </Notice>
      )}

      {result && extracted && (
        <Card
          isLight={isLight}
          title={result.applied ? "Applied" : "What the AI read"}
          subtitle={
            `Confidence ${Math.round(extracted.confidence * 100)}% — its own estimate of how completely the source describes the business.` +
            (source ? ` Source: ${source}.` : "")
          }
          icon={result.applied ? Check : Sparkles}
          actions={
            !result.applied && (
              <Button
                isLight={isLight}
                variant="primary"
                icon={Check}
                busy={apply.busy}
                disabled={!extracted}
                onClick={applyNow}
              >
                Apply to my profile
              </Button>
            )
          }
        >
          {result.kind && (
            <div className="mb-3 flex items-center gap-1.5">
              <Badge isLight={isLight} tone="info">
                <FileText className="w-3 h-3 mr-1 inline" />
                {KIND_LABEL[result.kind] ?? "Read from file"}
              </Badge>
              {typeof result.charCount === "number" && result.charCount > 0 && (
                <span className={`text-[11px] ${t.faint}`}>
                  {result.charCount.toLocaleString()} characters read
                </span>
              )}
            </div>
          )}

          {result.applied && (
            <div className="mb-4">
              <Notice isLight={isLight} tone="success">
                Empty fields filled, lists merged. Added {result.createdProducts} product
                {result.createdProducts === 1 ? "" : "s"} and {result.createdServices} service
                {result.createdServices === 1 ? "" : "s"}.
              </Notice>
            </div>
          )}

          <ErrorNotice isLight={isLight} error={apply.error} onDismiss={apply.clearError} />

          <div className="grid md:grid-cols-2 gap-x-6 gap-y-3">
            <ReadRow isLight={isLight} label="Business name" value={extracted.businessName} />
            <ReadRow isLight={isLight} label="Industry" value={extracted.industry} />
            <ReadRow isLight={isLight} label="Business type" value={extracted.businessType} />
            <ReadRow isLight={isLight} label="Brand voice" value={extracted.brandVoice} />
            <ReadRow
              isLight={isLight}
              label="Description"
              value={extracted.description}
              className="md:col-span-2"
            />
            <ReadList isLight={isLight} label="Customer types" values={extracted.targetCustomerTypes} />
            <ReadList isLight={isLight} label="Locations served" values={extracted.locationsServed} />
            <ReadList isLight={isLight} label="Differentiators" values={extracted.uniqueSellingPoints} />
            <ReadList isLight={isLight} label="Decision makers" values={extracted.decisionMakerRoles} />
            <ReadList isLight={isLight} label="Industries" values={extracted.targetIndustries} />
            <ReadList isLight={isLight} label="Certifications" values={extracted.certifications} />
          </div>

          {(extracted.products.length > 0 || extracted.services.length > 0) && (
            <div className={`mt-5 pt-4 border-t ${t.border} grid md:grid-cols-2 gap-5`}>
              <div>
                <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${t.muted}`}>
                  Products found ({extracted.products.length})
                </div>
                <ul className="space-y-1">
                  {extracted.products.map((p) => (
                    <li key={p.name} className={`text-xs ${t.body}`}>
                      <span className="font-semibold">{p.name}</span>
                      {p.description && <span className={t.muted}> — {p.description}</span>}
                    </li>
                  ))}
                  {extracted.products.length === 0 && (
                    <li className={`text-xs ${t.faint}`}>None</li>
                  )}
                </ul>
              </div>
              <div>
                <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${t.muted}`}>
                  Services found ({extracted.services.length})
                </div>
                <ul className="space-y-1">
                  {extracted.services.map((s) => (
                    <li key={s.name} className={`text-xs ${t.body}`}>
                      <span className="font-semibold">{s.name}</span>
                      {s.description && <span className={t.muted}> — {s.description}</span>}
                    </li>
                  ))}
                  {extracted.services.length === 0 && (
                    <li className={`text-xs ${t.faint}`}>None</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {extracted.missingInformation.length > 0 && (
            <div className="mt-5">
              <Notice isLight={isLight} tone="warn" title="The AI could not find these">
                <ul className="space-y-0.5 mt-1">
                  {extracted.missingInformation.map((q, i) => (
                    <li key={i}>• {q}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ReadRow({
  isLight,
  label,
  value,
  className = "",
}: Themed & { label: string; value: string | null; className?: string }) {
  const t = tokens(isLight);
  return (
    <div className={className}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${t.muted}`}>{label}</div>
      <div className={`text-xs mt-0.5 leading-relaxed ${value ? t.body : t.faint}`}>
        {value || "Not stated"}
      </div>
    </div>
  );
}

function ReadList({ isLight, label, values }: Themed & { label: string; values: string[] }) {
  const t = tokens(isLight);
  return (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${t.muted}`}>{label}</div>
      {values.length === 0 ? (
        <div className={`text-xs mt-0.5 ${t.faint}`}>Not stated</div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {values.map((v) => (
            <span key={v} className={`text-[10px] px-1.5 py-0.5 rounded ${t.chip}`}>
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
