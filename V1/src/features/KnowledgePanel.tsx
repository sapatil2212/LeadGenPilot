/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Knowledge base: documents, retrieval and structured facts.
 *
 * The document list leads with processing status rather than filename, because
 * status is what determines whether a document is actually usable: extraction,
 * chunking and embedding are separate failure points with different fixes, and
 * "this PDF is a scan" and "no embedding provider is configured" both mean "not
 * searchable" while needing completely different action.
 *
 * The search tab exists so retrieval can be inspected directly. When an assistant
 * answer looks wrong the first question is whether the right excerpts were
 * retrieved, and that is unanswerable if retrieval is only reachable through a
 * chat turn.
 */

import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import {
  api,
  type DocumentView,
  type KnowledgeItemView,
  type KnowledgeStats,
  type RetrievedChunkView,
} from "../ui/api";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNotice,
  Field,
  Notice,
  Select,
  Spinner,
  SubTabs,
  TextArea,
  TextInput,
  formatAgo,
  formatBytes,
  tokens,
  useAction,
  useAsync,
  type Themed,
} from "../ui/primitives";

type Tab = "documents" | "search" | "facts";

export default function KnowledgePanel({ isLight }: Themed) {
  const [tab, setTab] = useState<Tab>("documents");
  const stats = useAsync<KnowledgeStats>(() => api.get("/api/knowledge/stats"));

  return (
    <div className="space-y-5">
      <StatsStrip isLight={isLight} state={stats} />

      <SubTabs<Tab>
        isLight={isLight}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "documents", label: "Documents", icon: FileText, count: stats.data?.documents },
          { id: "search", label: "Test retrieval", icon: Search },
          { id: "facts", label: "Facts", icon: Tag },
        ]}
      />

      {tab === "documents" && <DocumentsTab isLight={isLight} onChanged={stats.reload} />}
      {tab === "search" && <SearchTab isLight={isLight} stats={stats.data} />}
      {tab === "facts" && <FactsTab isLight={isLight} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

function StatsStrip({
  isLight,
  state,
}: Themed & { state: ReturnType<typeof useAsync<KnowledgeStats>> }) {
  const t = tokens(isLight);
  const stats = state.data;

  if (state.loading && !stats) return null;

  const cells: { label: string; value: string; tone?: "bad" | "good" }[] = [
    { label: "Documents", value: String(stats?.documents ?? 0) },
    { label: "Ready", value: String(stats?.ready ?? 0), tone: "good" },
    {
      label: "Failed",
      value: String(stats?.failed ?? 0),
      ...(stats && stats.failed > 0 ? { tone: "bad" as const } : {}),
    },
    { label: "Retrievable chunks", value: String(stats?.chunks ?? 0) },
    { label: "With embeddings", value: String(stats?.embeddedChunks ?? 0) },
  ];

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-2 md:grid-cols-5 gap-3`}>
        {cells.map((cell) => (
          <div key={cell.label} className={`border rounded-xl px-3.5 py-3 ${t.card}`}>
            <div className={`text-[10px] font-semibold uppercase tracking-wide ${t.muted}`}>
              {cell.label}
            </div>
            <div
              className={`text-xl font-bold tabular-nums mt-0.5 ${
                cell.tone === "bad"
                  ? "text-rose-500"
                  : cell.tone === "good"
                    ? "text-emerald-500"
                    : t.heading
              }`}
            >
              {cell.value}
            </div>
          </div>
        ))}
      </div>

      {stats && !stats.embeddingsAvailable && (
        <Notice isLight={isLight} tone="warn" title="Semantic search is off">
          No AI provider with embedding support is configured, so retrieval falls back to keyword
          matching. It still works — it is just less able to connect a question to a paragraph that
          answers it in different words. Set <code className="font-mono">GEMINI_API_KEY</code> or{" "}
          <code className="font-mono">OPENAI_API_KEY</code>, then reprocess your documents.
        </Notice>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, "good" | "bad" | "info" | "neutral"> = {
  ready: "good",
  failed: "bad",
  pending: "info",
  extracting: "info",
  chunking: "info",
  embedding: "info",
};

interface UploadOutcome {
  document: DocumentView;
  duplicateOf?: string;
  warning?: string;
  extracted?: unknown;
}

function DocumentsTab({ isLight, onChanged }: Themed & { onChanged: () => void }) {
  const t = tokens(isLight);
  const docs = useAsync<DocumentView[]>(() => api.get("/api/knowledge/documents"));
  const upload = useAction();
  const mutate = useAction();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);

  const submit = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    if (category.trim()) form.append("category", category.trim());

    const result = await upload.run<UploadOutcome>(() =>
      api.upload("/api/knowledge/documents", form)
    );
    if (result) {
      setOutcome(result);
      setFile(null);
      setTitle("");
      setCategory("");
      docs.reload();
      onChanged();
    }
  };

  const reprocess = async (id: string) => {
    const ok = await mutate.run(() => api.post(`/api/knowledge/documents/${id}/reprocess`));
    if (ok) {
      docs.reload();
      onChanged();
    }
  };

  const remove = async (id: string) => {
    const ok = await mutate.run(() => api.del(`/api/knowledge/documents/${id}`));
    if (ok) {
      docs.reload();
      onChanged();
    }
  };

  return (
    <div className="space-y-5">
      <Card
        isLight={isLight}
        title="Upload a document"
        subtitle="PDF, DOCX, PPTX, TXT or MD, up to 20 MB. The text is extracted and indexed; the original file is not kept."
        icon={Upload}
      >
        <div className="grid md:grid-cols-3 gap-4">
          <Field isLight={isLight} label="File" className="md:col-span-1">
            <label
              className={`flex items-center gap-2 border border-dashed rounded-lg px-3 py-2.5 text-xs cursor-pointer transition-colors ${t.input} hover:border-indigo-500`}
            >
              <Upload className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">{file ? file.name : "Choose a file…"}</span>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.markdown"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>
          <Field isLight={isLight} label="Title" hint="Defaults to the filename.">
            <TextInput
              isLight={isLight}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product catalogue 2026"
            />
          </Field>
          <Field isLight={isLight} label="Category" hint="Optional label, e.g. product_catalogue.">
            <TextInput
              isLight={isLight}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4 mt-4">
          <p className={`text-[11px] leading-relaxed ${t.faint} max-w-xl`}>
            Re-uploading the same file is detected by checksum and returned instead of indexed twice —
            a duplicate would double that document's weight in every search.
          </p>
          <Button
            isLight={isLight}
            variant="primary"
            icon={Upload}
            busy={upload.busy}
            disabled={!file}
            onClick={submit}
          >
            Upload and index
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          <ErrorNotice isLight={isLight} error={upload.error} onDismiss={upload.clearError} />
          {outcome && (
            <Notice
              isLight={isLight}
              tone={
                outcome.document.status === "failed"
                  ? "warn"
                  : outcome.duplicateOf
                    ? "info"
                    : outcome.warning
                      ? "warn"
                      : "success"
              }
              title={
                outcome.duplicateOf
                  ? "Already in your knowledge base"
                  : outcome.document.status === "failed"
                    ? "Stored, but not usable"
                    : outcome.warning
                      ? "Indexed with a caveat"
                      : "Indexed"
              }
              onDismiss={() => setOutcome(null)}
            >
              {outcome.warning ?? (
                <>
                  {outcome.document.chunkCount} retrievable chunk
                  {outcome.document.chunkCount === 1 ? "" : "s"} from{" "}
                  {outcome.document.charCount?.toLocaleString()} characters.
                </>
              )}
            </Notice>
          )}
        </div>
      </Card>

      <Card
        isLight={isLight}
        title="Indexed documents"
        icon={FileText}
        actions={
          <Button isLight={isLight} icon={RefreshCw} onClick={docs.reload}>
            Refresh
          </Button>
        }
      >
        <ErrorNotice isLight={isLight} error={mutate.error} onDismiss={mutate.clearError} />

        {docs.loading ? (
          <Spinner isLight={isLight} />
        ) : docs.error ? (
          <ErrorNotice isLight={isLight} error={docs.error} />
        ) : (docs.data ?? []).length === 0 ? (
          <EmptyState isLight={isLight} icon={FileText} title="No documents yet">
            Upload a brochure, catalogue or company profile. The assistant answers from these
            excerpts rather than from what the model guesses about your industry.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {(docs.data ?? []).map((doc) => (
              <div key={doc.id} className={`border rounded-xl px-4 py-3 ${t.inset}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${t.heading}`}>{doc.title}</span>
                      <Badge isLight={isLight} tone={STATUS_TONE[doc.status] ?? "neutral"}>
                        {doc.status}
                      </Badge>
                      <Badge isLight={isLight}>{doc.fileType}</Badge>
                      {doc.embedded ? (
                        <Badge isLight={isLight} tone="info">
                          semantic
                        </Badge>
                      ) : doc.status === "ready" ? (
                        <Badge isLight={isLight}>keyword only</Badge>
                      ) : null}
                      {doc.category && <Badge isLight={isLight}>{doc.category}</Badge>}
                    </div>
                    <div className={`text-[11px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5 ${t.muted}`}>
                      <span>{doc.originalName}</span>
                      <span>{formatBytes(doc.sizeBytes)}</span>
                      {doc.chunkCount !== null && <span>{doc.chunkCount} chunks</span>}
                      {doc.charCount !== null && (
                        <span>{doc.charCount.toLocaleString()} characters</span>
                      )}
                      <span>added {formatAgo(doc.createdAt)}</span>
                      {doc.embeddingModel && (
                        <span className="font-mono">{doc.embeddingModel}</span>
                      )}
                    </div>
                    {doc.error && (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-500">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{doc.error}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      isLight={isLight}
                      variant="ghost"
                      icon={RefreshCw}
                      busy={mutate.busy}
                      onClick={() => reprocess(doc.id)}
                      title="Re-chunk and re-embed from the stored text"
                    >
                      Reprocess
                    </Button>
                    <ConfirmButton
                      isLight={isLight}
                      icon={Trash2}
                      label="Delete"
                      onConfirm={() => remove(doc.id)}
                      busy={mutate.busy}
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

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval
// ─────────────────────────────────────────────────────────────────────────────

function SearchTab({ isLight, stats }: Themed & { stats: KnowledgeStats | null }) {
  const t = tokens(isLight);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(6);
  const search = useAction();
  const [results, setResults] = useState<{ query: string; count: number; results: RetrievedChunkView[] } | null>(
    null
  );

  const run = async () => {
    const outcome = await search.run<{ query: string; count: number; results: RetrievedChunkView[] }>(
      () => api.post("/api/knowledge/search", { query, limit })
    );
    if (outcome) setResults(outcome);
  };

  return (
    <div className="space-y-5">
      <Card
        isLight={isLight}
        title="Test retrieval"
        subtitle="Exactly what the assistant is given for a question. Ask something your documents should answer."
        icon={Search}
      >
        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <Field isLight={isLight} label="Question" className="flex-1">
            <TextInput
              isLight={isLight}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) run();
              }}
              placeholder="What is the warranty on the PX-100?"
            />
          </Field>
          <Field isLight={isLight} label="Results" className="w-28">
            <Select
              isLight={isLight}
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[3, 6, 10, 15, 25].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            isLight={isLight}
            variant="primary"
            icon={Search}
            busy={search.busy}
            disabled={!query.trim()}
            onClick={run}
          >
            Search
          </Button>
        </div>

        <div className="mt-3">
          <ErrorNotice isLight={isLight} error={search.error} onDismiss={search.clearError} />
        </div>

        {stats && stats.chunks === 0 && (
          <div className="mt-3">
            <Notice isLight={isLight} tone="info">
              There is nothing indexed yet, so every search will come back empty. Upload a document
              first.
            </Notice>
          </div>
        )}
      </Card>

      {results && (
        <Card
          isLight={isLight}
          title={`${results.count} excerpt${results.count === 1 ? "" : "s"} retrieved`}
          subtitle={
            results.count === 0
              ? "Nothing scored above the relevance floor. That is a deliberate answer, not a failure."
              : undefined
          }
          icon={Database}
        >
          {results.count === 0 ? (
            <EmptyState isLight={isLight} icon={Search} title="No excerpt was relevant enough">
              Retrieval drops weak matches rather than padding the result with the least irrelevant
              text it can find — that is how a grounded assistant ends up confidently citing an
              unrelated document. The assistant will say it does not know instead.
            </EmptyState>
          ) : (
            <div className="space-y-2.5">
              {results.results.map((chunk, index) => (
                <div key={chunk.chunkId} className={`border rounded-xl px-4 py-3 ${t.inset}`}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-[10px] font-bold h-4 w-4 rounded flex items-center justify-center shrink-0 ${t.chip}`}
                      >
                        {index + 1}
                      </span>
                      <span className={`text-xs font-semibold truncate ${t.heading}`}>
                        {chunk.documentTitle}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge isLight={isLight} tone={chunk.method === "embedding" ? "info" : "neutral"}>
                        {chunk.method}
                      </Badge>
                      <span className={`text-[11px] font-mono tabular-nums ${t.muted}`}>
                        {chunk.score.toFixed(3)}
                      </span>
                    </div>
                  </div>
                  <p className={`text-xs leading-relaxed whitespace-pre-wrap ${t.body}`}>
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured facts
// ─────────────────────────────────────────────────────────────────────────────

function FactsTab({ isLight }: Themed) {
  const t = tokens(isLight);
  const items = useAsync<KnowledgeItemView[]>(() => api.get("/api/knowledge/items"));
  const categories = useAsync<{ categories: string[] }>(() => api.get("/api/knowledge/categories"));
  const action = useAction();

  const [category, setCategory] = useState("other");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  const add = async () => {
    const created = await action.run(() =>
      api.post("/api/knowledge/items", { category, label, value })
    );
    if (created) {
      setLabel("");
      setValue("");
      items.reload();
    }
  };

  const remove = async (id: string) => {
    const ok = await action.run(() => api.del(`/api/knowledge/items/${id}`));
    if (ok) items.reload();
  };

  const grouped = (items.data ?? []).reduce<Record<string, KnowledgeItemView[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <Card
        isLight={isLight}
        title="Add a fact"
        subtitle="Anything worth remembering that has no field of its own — warranty terms, lead times, a certification number."
        icon={Tag}
      >
        <div className="grid md:grid-cols-4 gap-3 md:items-end">
          <Field isLight={isLight} label="Category">
            <Select isLight={isLight} value={category} onChange={(e) => setCategory(e.target.value)}>
              {(categories.data?.categories ?? ["other"]).map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field isLight={isLight} label="Label">
            <TextInput
              isLight={isLight}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Warranty"
            />
          </Field>
          <Field isLight={isLight} label="Value" className="md:col-span-1">
            <TextInput
              isLight={isLight}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="36 months on all parts"
            />
          </Field>
          <Button
            isLight={isLight}
            variant="primary"
            icon={Plus}
            busy={action.busy}
            disabled={!label.trim() || !value.trim()}
            onClick={add}
          >
            Add fact
          </Button>
        </div>
        <div className="mt-3">
          <ErrorNotice isLight={isLight} error={action.error} onDismiss={action.clearError} />
        </div>
      </Card>

      <Card isLight={isLight} title="Stored facts" icon={Database}>
        {items.loading ? (
          <Spinner isLight={isLight} />
        ) : items.error ? (
          <ErrorNotice isLight={isLight} error={items.error} />
        ) : (items.data ?? []).length === 0 ? (
          <EmptyState isLight={isLight} icon={Tag} title="No facts stored">
            These complement the business profile: the profile holds the fields the product knows it
            needs, this holds the arbitrary ones that matter to your business.
          </EmptyState>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([group, entries]) => (
              <div key={group}>
                <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${t.muted}`}>
                  {group.replace(/_/g, " ")}
                </div>
                <div className="space-y-1.5">
                  {entries.map((item) => (
                    <div
                      key={item.id}
                      className={`border rounded-lg px-3.5 py-2.5 flex items-start justify-between gap-3 ${t.inset}`}
                    >
                      <div className="min-w-0">
                        <div className={`text-xs font-semibold ${t.heading}`}>{item.label}</div>
                        <div className={`text-xs mt-0.5 leading-relaxed ${t.body}`}>{item.value}</div>
                        <div className={`text-[10px] mt-1 flex items-center gap-2 ${t.faint}`}>
                          <span>from {item.source}</span>
                          {item.confidence < 1 && (
                            <span>confidence {Math.round(item.confidence * 100)}%</span>
                          )}
                        </div>
                      </div>
                      <ConfirmButton
                        isLight={isLight}
                        icon={Trash2}
                        label="Delete"
                        onConfirm={() => remove(item.id)}
                        busy={action.busy}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
