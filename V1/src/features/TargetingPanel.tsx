/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Targeting (who to find) and scoring (how to rank what was found).
 *
 * Two halves of the same decision, so they share a panel. Discovery reads the
 * default customer profile; the lead list is then ordered by the default scoring
 * rule set. Both used to be compiled in — one vertical and one city in a shared
 * module object, and weights that only suited a web design agency.
 *
 * The scoring editor shows the achievable maximum and the point at which each
 * priority band starts, recomputed as weights change. Editing weights blind is
 * guesswork: the only way to know what a change does is to watch a lead's score
 * and band move, which is what the preview is for.
 */

import React, { useMemo, useState } from "react";
import {
  Crosshair,
  Gauge,
  MapPin,
  Plus,
  Sparkles,
  Star,
  Target,
  Trash2,
  Wand2,
  Check,
  X,
  ShieldOff,
  SlidersHorizontal,
  FlaskConical,
} from "lucide-react";
import {
  api,
  type IcpSuggestion,
  type IcpView,
  type RuleSetView,
  type ScorePreview,
  type ScoringRule,
  type SignalListing,
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
  Select,
  Spinner,
  SubTabs,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  tokens,
  useAction,
  useAsync,
  type Themed,
} from "../ui/primitives";

type Tab = "icp" | "scoring";

export default function TargetingPanel({ isLight }: Themed) {
  const [tab, setTab] = useState<Tab>("icp");
  const profiles = useAsync<IcpView[]>(() => api.get("/api/icp"));
  const ruleSets = useAsync<RuleSetView[]>(() => api.get("/api/scoring/rule-sets"));

  return (
    <div className="space-y-5">
      <SubTabs<Tab>
        isLight={isLight}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "icp", label: "Who to target", icon: Target, count: profiles.data?.length },
          { id: "scoring", label: "How to score", icon: Gauge, count: ruleSets.data?.length },
        ]}
      />
      {tab === "icp" && <IcpTab isLight={isLight} state={profiles} />}
      {tab === "scoring" && <ScoringTab isLight={isLight} state={ruleSets} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ideal customer profiles
// ─────────────────────────────────────────────────────────────────────────────

interface IcpDraft {
  id?: string;
  name: string;
  description: string;
  targetCategories: string[];
  targetIndustries: string[];
  targetLocations: string[];
  decisionMakerRoles: string[];
  excludeCategories: string[];
  excludeKeywords: string[];
  minRating: string;
  minReviews: string;
  maxResults: string;
  radiusKm: string;
  deepAnalysis: boolean;
}

function toDraft(profile?: IcpView): IcpDraft {
  return {
    ...(profile?.id ? { id: profile.id } : {}),
    name: profile?.name ?? "",
    description: profile?.description ?? "",
    targetCategories: profile?.targetCategories ?? [],
    targetIndustries: profile?.targetIndustries ?? [],
    targetLocations: profile?.targetLocations ?? [],
    decisionMakerRoles: profile?.decisionMakerRoles ?? [],
    excludeCategories: profile?.excludeCategories ?? [],
    excludeKeywords: profile?.excludeKeywords ?? [],
    minRating: profile?.minRating != null ? String(profile.minRating) : "",
    minReviews: profile?.minReviews != null ? String(profile.minReviews) : "",
    maxResults: String(profile?.maxResults ?? 50),
    radiusKm: profile?.radiusKm != null ? String(profile.radiusKm) : "",
    deepAnalysis: profile?.deepAnalysis ?? false,
  };
}

function IcpTab({ isLight, state }: Themed & { state: ReturnType<typeof useAsync<IcpView[]>> }) {
  const t = tokens(isLight);
  const action = useAction();
  const suggest = useAction();
  const [draft, setDraft] = useState<IcpDraft | null>(null);
  const [suggestion, setSuggestion] = useState<{
    suggestion: IcpSuggestion;
    applied: boolean;
    warning?: string;
  } | null>(null);
  const [guidance, setGuidance] = useState("");

  const profiles = state.data ?? [];

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    const body = {
      name: draft.name,
      description: draft.description || null,
      targetCategories: draft.targetCategories,
      targetIndustries: draft.targetIndustries,
      targetLocations: draft.targetLocations,
      decisionMakerRoles: draft.decisionMakerRoles,
      excludeCategories: draft.excludeCategories,
      excludeKeywords: draft.excludeKeywords,
      minRating: draft.minRating.trim() === "" ? null : Number(draft.minRating),
      minReviews: draft.minReviews.trim() === "" ? null : Number(draft.minReviews),
      maxResults: Number(draft.maxResults),
      radiusKm: draft.radiusKm.trim() === "" ? null : Number(draft.radiusKm),
      deepAnalysis: draft.deepAnalysis,
    };
    const saved = draft.id
      ? await action.run(() => api.patch(`/api/icp/${draft.id}`, body), "Profile saved.")
      : await action.run(() => api.post("/api/icp", body), "Profile created.");
    if (saved) {
      setDraft(null);
      state.reload();
    }
  };

  const runSuggest = async (apply: boolean) => {
    const result = await suggest.run<{ suggestion: IcpSuggestion; applied: boolean; warning?: string }>(
      () =>
        api.post("/api/icp/suggest", {
          guidance: guidance.trim() || null,
          apply,
          ...(draft?.id ? { profileId: draft.id } : {}),
        })
    );
    if (result) {
      setSuggestion(result);
      if (result.applied) {
        setDraft(null);
        state.reload();
      }
    }
  };

  const useSuggestion = () => {
    if (!suggestion) return;
    const s = suggestion.suggestion;
    setDraft((current) => ({
      ...(current ?? toDraft()),
      name: current?.name || s.name || "Suggested customer profile",
      description: current?.description || s.description || "",
      targetCategories: merge(current?.targetCategories ?? [], s.targetCategories),
      targetIndustries: merge(current?.targetIndustries ?? [], s.targetIndustries),
      targetLocations: merge(current?.targetLocations ?? [], s.targetLocations),
      decisionMakerRoles: merge(current?.decisionMakerRoles ?? [], s.decisionMakerRoles),
      excludeCategories: merge(current?.excludeCategories ?? [], s.excludeCategories),
      excludeKeywords: merge(current?.excludeKeywords ?? [], s.excludeKeywords),
    }));
  };

  return (
    <div className="space-y-5">
      <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
      {action.done && (
        <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>
          {action.done}
        </Notice>
      )}

      {/* AI suggestion */}
      <Card
        isLight={isLight}
        title="Let the AI propose a profile"
        subtitle="Reasons only from your business profile and your uploaded documents — never from what it assumes about your industry."
        icon={Wand2}
      >
        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <Field
            isLight={isLight}
            label="Any steer? (optional)"
            hint="E.g. 'we want to expand into Gujarat' or 'focus on private hospitals'."
            className="flex-1"
          >
            <TextInput
              isLight={isLight}
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="We want to expand into Gujarat"
            />
          </Field>
          <Button
            isLight={isLight}
            variant="primary"
            icon={Sparkles}
            busy={suggest.busy}
            onClick={() => runSuggest(false)}
          >
            Suggest targeting
          </Button>
        </div>

        <div className="mt-3">
          <ErrorNotice isLight={isLight} error={suggest.error} onDismiss={suggest.clearError} />
        </div>

        {suggestion && (
          <div className={`mt-4 border rounded-xl p-4 ${t.inset}`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${t.heading}`}>
                  {suggestion.suggestion.name || "Suggested profile"}
                </div>
                <div className={`text-[11px] mt-0.5 ${t.muted}`}>
                  Model confidence {Math.round(suggestion.suggestion.confidence * 100)}% — its own
                  estimate of how well your data supports this.
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button isLight={isLight} icon={Check} onClick={useSuggestion}>
                  Load into the editor
                </Button>
                <Button
                  isLight={isLight}
                  variant="primary"
                  icon={Check}
                  busy={suggest.busy}
                  onClick={() => runSuggest(true)}
                >
                  Apply directly
                </Button>
              </div>
            </div>

            {suggestion.warning && (
              <div className="mb-3">
                <Notice isLight={isLight} tone="warn">
                  {suggestion.warning}
                </Notice>
              </div>
            )}

            {suggestion.suggestion.rationale && (
              <p className={`text-xs leading-relaxed mb-3 ${t.body}`}>
                {suggestion.suggestion.rationale}
              </p>
            )}

            <div className="grid md:grid-cols-2 gap-x-6 gap-y-3">
              <SuggestList isLight={isLight} label="Target categories" values={suggestion.suggestion.targetCategories} />
              <SuggestList isLight={isLight} label="Locations" values={suggestion.suggestion.targetLocations} />
              <SuggestList isLight={isLight} label="Industries" values={suggestion.suggestion.targetIndustries} />
              <SuggestList isLight={isLight} label="Decision makers" values={suggestion.suggestion.decisionMakerRoles} />
              <SuggestList isLight={isLight} label="Exclude categories" values={suggestion.suggestion.excludeCategories} />
              <SuggestList isLight={isLight} label="Exclude keywords" values={suggestion.suggestion.excludeKeywords} />
            </div>

            {suggestion.suggestion.missingInformation.length > 0 && (
              <div className="mt-4">
                <Notice isLight={isLight} tone="info" title="It needs more from you">
                  <ul className="space-y-0.5 mt-1">
                    {suggestion.suggestion.missingInformation.map((q, i) => (
                      <li key={i}>• {q}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Editor */}
      {draft && (
        <Card
          isLight={isLight}
          title={draft.id ? "Edit profile" : "New customer profile"}
          icon={Target}
          actions={
            <>
              <Button isLight={isLight} variant="ghost" icon={X} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                isLight={isLight}
                variant="primary"
                icon={Check}
                busy={action.busy}
                disabled={!draft.name.trim()}
                onClick={save}
              >
                Save profile
              </Button>
            </>
          }
        >
          <div className="grid md:grid-cols-2 gap-4">
            <Field isLight={isLight} label="Profile name">
              <TextInput
                isLight={isLight}
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Mid-size hospitals in Maharashtra"
              />
            </Field>
            <Field isLight={isLight} label="Description">
              <TextInput
                isLight={isLight}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>

            <Field
              isLight={isLight}
              label="Target categories"
              hint="Phrase these the way businesses list themselves: 'Multispecialty Hospital', not 'large healthcare providers'. A category nobody lists themselves under returns nothing."
            >
              <TagInput
                isLight={isLight}
                values={draft.targetCategories}
                onChange={(targetCategories) => setDraft({ ...draft, targetCategories })}
                placeholder="Multispecialty Hospital"
              />
            </Field>
            <Field
              isLight={isLight}
              label="Locations to search"
              hint="Every category is searched in every location."
            >
              <TagInput
                isLight={isLight}
                values={draft.targetLocations}
                onChange={(targetLocations) => setDraft({ ...draft, targetLocations })}
                placeholder="Pune"
              />
            </Field>

            <Field isLight={isLight} label="Industries">
              <TagInput
                isLight={isLight}
                values={draft.targetIndustries}
                onChange={(targetIndustries) => setDraft({ ...draft, targetIndustries })}
              />
            </Field>
            <Field isLight={isLight} label="Decision-maker roles">
              <TagInput
                isLight={isLight}
                values={draft.decisionMakerRoles}
                onChange={(decisionMakerRoles) => setDraft({ ...draft, decisionMakerRoles })}
                placeholder="Procurement Manager"
              />
            </Field>

            <Field
              isLight={isLight}
              label="Exclude categories"
              hint="Businesses a search for the above would wrongly return."
            >
              <TagInput
                isLight={isLight}
                values={draft.excludeCategories}
                onChange={(excludeCategories) => setDraft({ ...draft, excludeCategories })}
                placeholder="Pharmacy"
              />
            </Field>
            <Field
              isLight={isLight}
              label="Exclude keywords"
              hint="Matched against the name too — useful for filtering out your own competitors."
            >
              <TagInput
                isLight={isLight}
                values={draft.excludeKeywords}
                onChange={(excludeKeywords) => setDraft({ ...draft, excludeKeywords })}
              />
            </Field>
          </div>

          <div className={`mt-5 pt-4 border-t ${t.border}`}>
            <div className={`text-[11px] font-semibold uppercase tracking-wide mb-3 ${t.muted}`}>
              Discovery settings
            </div>
            <div className="grid md:grid-cols-4 gap-4">
              <Field isLight={isLight} label="Max results" hint="Capped by your plan quota.">
                <TextInput
                  isLight={isLight}
                  type="number"
                  min={1}
                  max={5000}
                  value={draft.maxResults}
                  onChange={(e) => setDraft({ ...draft, maxResults: e.target.value })}
                />
              </Field>
              <Field isLight={isLight} label="Min rating" hint="Leave blank for no floor.">
                <TextInput
                  isLight={isLight}
                  type="number"
                  step="0.1"
                  min={0}
                  max={5}
                  value={draft.minRating}
                  onChange={(e) => setDraft({ ...draft, minRating: e.target.value })}
                />
              </Field>
              <Field isLight={isLight} label="Min reviews">
                <TextInput
                  isLight={isLight}
                  type="number"
                  min={0}
                  value={draft.minReviews}
                  onChange={(e) => setDraft({ ...draft, minReviews: e.target.value })}
                />
              </Field>
              <Field isLight={isLight} label="Radius (km)">
                <TextInput
                  isLight={isLight}
                  type="number"
                  min={1}
                  max={500}
                  value={draft.radiusKm}
                  onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Toggle
                isLight={isLight}
                checked={draft.deepAnalysis}
                onChange={(deepAnalysis) => setDraft({ ...draft, deepAnalysis })}
                label="Deep analysis"
                hint="Runs the full growth-intelligence pass on every lead. Slower and uses more quota."
              />
            </div>
          </div>
        </Card>
      )}

      {/* List */}
      <Card
        isLight={isLight}
        title="Customer profiles"
        subtitle="Discovery uses the one marked default."
        icon={Crosshair}
        actions={
          !draft && (
            <Button isLight={isLight} variant="primary" icon={Plus} onClick={() => setDraft(toDraft())}>
              New profile
            </Button>
          )
        }
      >
        {state.loading ? (
          <Spinner isLight={isLight} />
        ) : state.error ? (
          <ErrorNotice isLight={isLight} error={state.error} />
        ) : profiles.length === 0 ? (
          <EmptyState
            isLight={isLight}
            icon={Target}
            title="No customer profile yet"
            action={
              !draft && (
                <Button isLight={isLight} variant="primary" icon={Plus} onClick={() => setDraft(toDraft())}>
                  Create one
                </Button>
              )
            }
          >
            Discovery needs to know what kind of business to look for and where. Nothing is guessed
            for you — an invented target list would send a quota-spending search somewhere arbitrary.
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            {profiles.map((profile) => (
              <div key={profile.id} className={`border rounded-xl px-4 py-3.5 ${t.inset}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${t.heading}`}>{profile.name}</span>
                      {profile.isDefault && (
                        <Badge isLight={isLight} tone="info">
                          default
                        </Badge>
                      )}
                      {profile.readyForDiscovery ? (
                        <Badge isLight={isLight} tone="good">
                          ready
                        </Badge>
                      ) : (
                        <Badge isLight={isLight} tone="warm">
                          incomplete
                        </Badge>
                      )}
                      {profile.aiConfidence !== null && (
                        <Badge isLight={isLight}>
                          ai {Math.round(profile.aiConfidence * 100)}%
                        </Badge>
                      )}
                    </div>

                    {profile.description && (
                      <p className={`text-xs mt-1 ${t.muted}`}>{profile.description}</p>
                    )}

                    <div className="mt-2.5 space-y-1.5">
                      <ChipRow
                        isLight={isLight}
                        icon={Target}
                        label="Looking for"
                        values={profile.targetCategories}
                        empty="no categories set"
                      />
                      <ChipRow
                        isLight={isLight}
                        icon={MapPin}
                        label="In"
                        values={profile.targetLocations}
                        empty="no locations set"
                      />
                      {profile.excludeCategories.length + profile.excludeKeywords.length > 0 && (
                        <ChipRow
                          isLight={isLight}
                          icon={ShieldOff}
                          label="Excluding"
                          values={[...profile.excludeCategories, ...profile.excludeKeywords]}
                        />
                      )}
                    </div>

                    <div className={`text-[11px] mt-2.5 flex flex-wrap gap-x-3 ${t.faint}`}>
                      <span>up to {profile.maxResults} results</span>
                      {profile.minRating !== null && <span>rating ≥ {profile.minRating}</span>}
                      {profile.minReviews !== null && <span>reviews ≥ {profile.minReviews}</span>}
                      {profile.radiusKm !== null && <span>{profile.radiusKm} km radius</span>}
                      {profile.deepAnalysis && <span>deep analysis on</span>}
                    </div>

                    <div className="mt-3 max-w-xs">
                      <Meter
                        isLight={isLight}
                        value={profile.completeness}
                        max={100}
                        label="Completeness"
                        tone={profile.completeness >= 65 ? "emerald" : "amber"}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Button
                      isLight={isLight}
                      variant="ghost"
                      icon={SlidersHorizontal}
                      onClick={() => setDraft(toDraft(profile))}
                    >
                      Edit
                    </Button>
                    {!profile.isDefault && (
                      <Button
                        isLight={isLight}
                        variant="ghost"
                        icon={Star}
                        busy={action.busy}
                        onClick={async () => {
                          const ok = await action.run(
                            () => api.post(`/api/icp/${profile.id}/default`),
                            "Default updated."
                          );
                          if (ok) state.reload();
                        }}
                      >
                        Make default
                      </Button>
                    )}
                    <ConfirmButton
                      isLight={isLight}
                      icon={Trash2}
                      label="Delete"
                      busy={action.busy}
                      onConfirm={async () => {
                        const ok = await action.run(() => api.del(`/api/icp/${profile.id}`));
                        if (ok) state.reload();
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function merge(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((v) => v.toLowerCase()));
  return [...current, ...incoming.filter((v) => !seen.has(v.toLowerCase()))];
}

function SuggestList({ isLight, label, values }: Themed & { label: string; values: string[] }) {
  const t = tokens(isLight);
  return (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${t.muted}`}>{label}</div>
      {values.length === 0 ? (
        <div className={`text-xs mt-0.5 ${t.faint}`}>Nothing proposed</div>
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

function ChipRow({
  isLight,
  icon: Icon,
  label,
  values,
  empty,
}: Themed & {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  values: string[];
  empty?: string;
}) {
  const t = tokens(isLight);
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-3 w-3 mt-1 shrink-0 ${t.faint}`} />
      <span className={`text-[11px] font-medium mt-0.5 shrink-0 ${t.muted}`}>{label}</span>
      {values.length === 0 ? (
        <span className={`text-[11px] mt-0.5 italic ${t.faint}`}>{empty}</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {values.map((v) => (
            <span key={v} className={`text-[10px] px-1.5 py-0.5 rounded ${t.chip}`}>
              {v}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_PRESETS: { label: string; lead: Record<string, unknown> }[] = [
  {
    label: "No website, strong reputation",
    lead: {
      businessName: "Sample Clinic",
      websiteStatus: "MISSING",
      rating: 4.8,
      reviews: 320,
      instagramStatus: "NOT_FOUND",
      facebookStatus: "NOT_FOUND",
      linkedinStatus: "NOT_FOUND",
    },
  },
  {
    label: "Dated website, some social",
    lead: {
      businessName: "Sample Clinic",
      websiteStatus: "OUTDATED",
      rating: 4.3,
      reviews: 80,
      instagramStatus: "INACTIVE",
      facebookStatus: "ACTIVE",
      linkedinStatus: "ACTIVE",
      whatsappPresent: true,
    },
  },
  {
    label: "Fully established",
    lead: {
      businessName: "Sample Clinic",
      websiteStatus: "WORKING",
      rating: 4.6,
      reviews: 150,
      instagramStatus: "ACTIVE",
      facebookStatus: "ACTIVE",
      linkedinStatus: "ACTIVE",
      whatsappPresent: true,
      appointmentSystem: true,
      googleAnalyticsPresent: true,
      metaPixelPresent: true,
      emails: ["hello@example.com"],
    },
  },
];

function ScoringTab({
  isLight,
  state,
}: Themed & { state: ReturnType<typeof useAsync<RuleSetView[]>> }) {
  const t = tokens(isLight);
  const signals = useAsync<{ signals: SignalListing[] }>(() => api.get("/api/scoring/signals"));
  const action = useAction();
  const [editing, setEditing] = useState<RuleSetView | null>(null);
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [hot, setHot] = useState(0.58);
  const [warm, setWarm] = useState(0.35);
  const [preview, setPreview] = useState<ScorePreview | null>(null);

  const ruleSets = state.data ?? [];

  const startEdit = (ruleSet: RuleSetView) => {
    setEditing(ruleSet);
    setRules(ruleSet.rules.map((r) => ({ ...r })));
    setHot(ruleSet.hotThreshold);
    setWarm(ruleSet.warmThreshold);
    setPreview(null);
  };

  const signalById = useMemo(() => {
    const map = new Map<string, SignalListing>();
    for (const s of signals.data?.signals ?? []) map.set(s.id, s);
    return map;
  }, [signals.data]);

  /**
   * The achievable maximum, mirroring the server's arithmetic: signals sharing an
   * exclusive group contribute only their best-paying member, because they read
   * the same attribute and cannot both fire.
   */
  const localMax = useMemo(() => {
    const groups = new Map<string, number>();
    let ungrouped = 0;
    for (const rule of rules) {
      if (rule.enabled === false || rule.points <= 0) continue;
      const group = signalById.get(rule.signal)?.exclusiveGroup;
      if (group) groups.set(group, Math.max(groups.get(group) ?? 0, rule.points));
      else ungrouped += rule.points;
    }
    let total = ungrouped;
    for (const best of groups.values()) total += best;
    return total;
  }, [rules, signalById]);

  const save = async () => {
    if (!editing) return;
    const saved = await action.run(
      () =>
        api.patch(`/api/scoring/rule-sets/${editing.id}`, {
          rules,
          hotThreshold: hot,
          warmThreshold: warm,
        }),
      "Scoring updated. Leads scored from now on carry the new version."
    );
    if (saved) {
      setEditing(null);
      state.reload();
    }
  };

  const runPreview = async (lead: Record<string, unknown>) => {
    if (!editing) return;
    const result = await action.run<ScorePreview>(() =>
      api.post(`/api/scoring/rule-sets/${editing.id}/preview`, lead)
    );
    if (result) setPreview(result);
  };

  const grouped = useMemo(() => {
    const byCategory = new Map<string, SignalListing[]>();
    for (const s of signals.data?.signals ?? []) {
      const list = byCategory.get(s.category) ?? [];
      list.push(s);
      byCategory.set(s.category, list);
    }
    return byCategory;
  }, [signals.data]);

  return (
    <div className="space-y-5">
      <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
      {action.done && (
        <Notice isLight={isLight} tone="success" onDismiss={action.clearDone}>
          {action.done}
        </Notice>
      )}

      {!editing && (
        <Card
          isLight={isLight}
          title="Scoring configurations"
          subtitle="Lead priority comes from these weights. The default is used by discovery."
          icon={Gauge}
        >
          {state.loading ? (
            <Spinner isLight={isLight} />
          ) : state.error ? (
            <ErrorNotice isLight={isLight} error={state.error} />
          ) : ruleSets.length === 0 ? (
            <EmptyState isLight={isLight} icon={Gauge} title="Nothing configured yet">
              A starting configuration is created automatically the first time discovery runs. Open
              the Lead Finder once, or refresh this page.
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {ruleSets.map((ruleSet) => (
                <div key={ruleSet.id} className={`border rounded-xl px-4 py-3.5 ${t.inset}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-semibold ${t.heading}`}>{ruleSet.name}</span>
                        <Badge isLight={isLight}>v{ruleSet.version}</Badge>
                        {ruleSet.isDefault && (
                          <Badge isLight={isLight} tone="info">
                            default
                          </Badge>
                        )}
                        {ruleSet.isBuiltIn && <Badge isLight={isLight}>as shipped</Badge>}
                      </div>
                      {ruleSet.description && (
                        <p className={`text-xs mt-1 leading-relaxed ${t.muted}`}>
                          {ruleSet.description}
                        </p>
                      )}
                      <div className={`text-[11px] mt-2 flex flex-wrap gap-x-4 ${t.faint}`}>
                        <span>
                          {ruleSet.rules.filter((r) => r.enabled !== false).length} active rule
                          {ruleSet.rules.filter((r) => r.enabled !== false).length === 1 ? "" : "s"}
                        </span>
                        <span>max {ruleSet.maxScore} points</span>
                        <span className="text-rose-400">HOT from {ruleSet.hotAtPoints}</span>
                        <span className="text-amber-400">WARM from {ruleSet.warmAtPoints}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Button
                        isLight={isLight}
                        variant="ghost"
                        icon={SlidersHorizontal}
                        onClick={() => startEdit(ruleSet)}
                      >
                        Tune weights
                      </Button>
                      {!ruleSet.isDefault && (
                        <Button
                          isLight={isLight}
                          variant="ghost"
                          icon={Star}
                          busy={action.busy}
                          onClick={async () => {
                            const ok = await action.run(
                              () => api.post(`/api/scoring/rule-sets/${ruleSet.id}/default`),
                              "Default updated."
                            );
                            if (ok) state.reload();
                          }}
                        >
                          Make default
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {editing && (
        <>
          <Card
            isLight={isLight}
            title={`Tuning "${editing.name}"`}
            subtitle="Each rule tests one observable fact. The sign and size of the points are yours — the same fact means opposite things to different sellers."
            icon={SlidersHorizontal}
            actions={
              <>
                <Button isLight={isLight} variant="ghost" icon={X} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  isLight={isLight}
                  variant="primary"
                  icon={Check}
                  busy={action.busy}
                  onClick={save}
                >
                  Save as v{editing.version + 1}
                </Button>
              </>
            }
          >
            <div className={`border rounded-xl p-4 mb-5 ${t.inset}`}>
              <div className="grid md:grid-cols-3 gap-5 items-end">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${t.muted}`}>
                    Achievable maximum
                  </div>
                  <div className={`text-2xl font-bold tabular-nums ${t.heading}`}>{localMax}</div>
                  <div className={`text-[11px] mt-0.5 ${t.faint}`}>
                    Recomputed as you edit. Mutually exclusive signals count once.
                  </div>
                </div>
                <Field
                  isLight={isLight}
                  label={`HOT from ${Math.ceil(hot * localMax - 1e-9)} points`}
                  hint="A share of the maximum, so changing a weight cannot move the band by accident."
                >
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={hot}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setHot(next);
                      if (warm >= next) setWarm(Math.max(0.01, next - 0.05));
                    }}
                    className="w-full accent-rose-500 cursor-pointer"
                  />
                </Field>
                <Field isLight={isLight} label={`WARM from ${Math.ceil(warm * localMax - 1e-9)} points`}>
                  <input
                    type="range"
                    min={0.01}
                    max={0.99}
                    step={0.01}
                    value={warm}
                    onChange={(e) => setWarm(Math.min(Number(e.target.value), hot - 0.01))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </Field>
              </div>
            </div>

            {signals.loading ? (
              <Spinner isLight={isLight} />
            ) : (
              <div className="space-y-5">
                {Array.from(grouped.entries()).map(([category, list]) => (
                  <div key={category}>
                    <div
                      className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${t.muted}`}
                    >
                      {category}
                    </div>
                    <div className="space-y-1.5">
                      {list.map((signal) => {
                        const rule = rules.find((r) => r.signal === signal.id);
                        return (
                          <div key={signal.id}>
                            <RuleRow
                              isLight={isLight}
                              signal={signal}
                              rule={rule}
                              onChange={(next) =>
                                setRules((current) => {
                                  const without = current.filter((r) => r.signal !== signal.id);
                                  return next ? [...without, next] : without;
                                })
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            isLight={isLight}
            title="Try it on a lead"
            subtitle="The only way to know what a weight change does is to watch a score and band move."
            icon={FlaskConical}
          >
            <div className="flex flex-wrap gap-2">
              {PREVIEW_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  isLight={isLight}
                  busy={action.busy}
                  onClick={() => runPreview(preset.lead)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            {preview && (
              <div className={`border rounded-xl p-4 mt-4 ${t.inset}`}>
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold tabular-nums ${t.heading}`}>
                      {preview.score}
                    </span>
                    <span className={`text-sm ${t.faint}`}>/ {preview.max}</span>
                    <span className={`text-xs ml-1 ${t.muted}`}>
                      {Math.round(preview.ratio * 100)}%
                    </span>
                  </div>
                  <Badge
                    isLight={isLight}
                    tone={
                      preview.priority === "HOT"
                        ? "hot"
                        : preview.priority === "WARM"
                          ? "warm"
                          : "cold"
                    }
                  >
                    {preview.priority}
                  </Badge>
                </div>

                <Meter
                  isLight={isLight}
                  value={preview.score}
                  max={preview.max}
                  tone={
                    preview.priority === "HOT"
                      ? "indigo"
                      : preview.priority === "WARM"
                        ? "amber"
                        : "emerald"
                  }
                />

                <div className={`mt-4 text-[11px] font-semibold uppercase tracking-wide ${t.muted}`}>
                  Rules that fired
                </div>
                {preview.breakdown.length === 0 ? (
                  <p className={`text-xs mt-1 ${t.faint}`}>None — nothing about this lead scored.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {preview.breakdown.map((row) => (
                      <div
                        key={row.signal}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className={t.body}>{row.label}</span>
                        <span
                          className={`font-semibold tabular-nums ${
                            row.points >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {row.points >= 0 ? "+" : ""}
                          {row.points}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function RuleRow({
  isLight,
  signal,
  rule,
  onChange,
}: Themed & {
  signal: SignalListing;
  rule?: ScoringRule;
  onChange: (rule: ScoringRule | null) => void;
}) {
  const t = tokens(isLight);
  const active = !!rule && rule.enabled !== false;

  return (
    <div
      className={`border rounded-lg px-3.5 py-2.5 flex items-start gap-3 transition-colors ${
        active ? t.card : t.inset
      }`}
    >
      <button
        type="button"
        onClick={() =>
          onChange(
            rule
              ? null
              : {
                  id: signal.id,
                  signal: signal.id,
                  points: 10,
                  enabled: true,
                  ...(signal.defaultThreshold !== undefined ? { when: signal.defaultThreshold } : {}),
                }
          )
        }
        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
          active
            ? "bg-indigo-600 border-indigo-600 text-white"
            : isLight
              ? "border-slate-300"
              : "border-slate-600"
        }`}
        aria-label={active ? `Remove ${signal.label}` : `Add ${signal.label}`}
      >
        {active && <Check className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs font-medium ${active ? t.heading : t.muted}`}>
            {signal.label}
          </span>
          {signal.exclusiveGroup && (
            <span className={`text-[9px] px-1 py-0.5 rounded ${t.chip}`}>
              one of: {signal.exclusiveGroup}
            </span>
          )}
        </div>
        <p className={`text-[11px] mt-0.5 leading-relaxed ${t.faint}`}>{signal.description}</p>
      </div>

      {active && rule && (
        <div className="flex items-center gap-2 shrink-0">
          {signal.thresholdLabel && (
            <label className="flex items-center gap-1.5">
              <span className={`text-[10px] ${t.faint}`}>{signal.thresholdLabel}</span>
              <input
                type="number"
                step="any"
                value={rule.when ?? signal.defaultThreshold ?? 0}
                onChange={(e) => onChange({ ...rule, when: Number(e.target.value) })}
                className={`w-16 border rounded px-1.5 py-1 text-xs text-right tabular-nums outline-none focus:border-indigo-500 ${t.input}`}
              />
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <span className={`text-[10px] ${t.faint}`}>points</span>
            <input
              type="number"
              value={rule.points}
              onChange={(e) => onChange({ ...rule, points: Number(e.target.value) })}
              className={`w-16 border rounded px-1.5 py-1 text-xs text-right tabular-nums outline-none focus:border-indigo-500 ${t.input}`}
            />
          </label>
        </div>
      )}
    </div>
  );
}
