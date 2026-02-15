"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Key,
  ExternalLink,
  Plus,
  Users,
  Pencil,
  Save,
  CheckCircle2,
  Sparkles,
  Loader2,
} from "lucide-react";

const llmProviders = [
  { name: "OpenAI", envKey: "OPENAI_API_KEY", docsUrl: "https://platform.openai.com/api-keys" },
  { name: "Anthropic", envKey: "ANTHROPIC_API_KEY", docsUrl: "https://console.anthropic.com/settings/keys" },
  { name: "Google AI", envKey: "GOOGLE_GENERATIVE_AI_API_KEY", docsUrl: "https://aistudio.google.com/apikey" },
  { name: "OpenRouter", envKey: "OPENROUTER_API_KEY", docsUrl: "https://openrouter.ai/keys" },
  { name: "DeepSeek", envKey: "DEEPSEEK_API_KEY", docsUrl: "https://platform.deepseek.com/api_keys" },
];

const providerOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "deepseek", label: "DeepSeek" },
];

interface AgentRole {
  id: string;
  name: string;
  title: string;
  systemPrompt: string;
  modelConfig: string;
  isBuiltin: boolean;
}

interface ModelConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  inputModalities?: string[];
  outputModalities?: string[];
}

function parseConfig(raw: string): ModelConfig {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ─── Modality icons / labels ─────────────────────────────────────────────────

const modalityLabels: Record<string, { label: string; color: string }> = {
  text: { label: "Text", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  image: { label: "Image", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  audio: { label: "Audio", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" },
  video: { label: "Video", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  pdf: { label: "PDF", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  file: { label: "File", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
};

function ModalityBadges({ input, output }: { input?: string[]; output?: string[] }) {
  if (!input?.length && !output?.length) return null;

  const renderBadge = (mod: string) => {
    const info = modalityLabels[mod] ?? { label: mod, color: "bg-gray-100 text-gray-600" };
    return (
      <span
        key={mod}
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${info.color}`}
      >
        {info.label}
      </span>
    );
  };

  return (
    <div className="mt-1 space-y-0.5">
      {input && input.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">Input</span>
          {input.map((m) => renderBadge(m))}
        </div>
      )}
      {output && output.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">Output</span>
          {output.map((m) => renderBadge(m))}
        </div>
      )}
    </div>
  );
}

// ─── Hook to fetch model capabilities ────────────────────────────────────────

function useModelCapabilities() {
  const [loading, setLoading] = useState(false);
  const [caps, setCaps] = useState<{ inputModalities: string[]; outputModalities: string[] } | null>(null);

  const fetch_ = async (provider: string, model: string) => {
    if (!provider || !model) { setCaps(null); return null; }
    setLoading(true);
    try {
      const res = await fetch(`/api/models/capabilities?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`);
      if (res.ok) {
        const data = await res.json();
        setCaps({ inputModalities: data.inputModalities, outputModalities: data.outputModalities });
        return data;
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
    return null;
  };

  return { loading, caps, fetchCaps: fetch_, setCaps };
}

// ─── AI Prompt Assist Hook ──────────────────────────────────────────────────

function usePromptAssist() {
  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [showInput, setShowInput] = useState(false);

  /**
   * Stream-based generate/refine. Calls onStream with accumulated text
   * as chunks arrive, so the textarea updates in real-time.
   */
  const generate = async (
    mode: "generate" | "refine",
    roleTitle?: string,
    currentPrompt?: string,
    customInstruction?: string,
    onStream?: (text: string) => void
  ): Promise<string | null> => {
    const inst = customInstruction ?? instruction;
    if (!inst.trim()) return null;
    setLoading(true);
    try {
      const res = await fetch("/api/roles/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          instruction: inst,
          roleTitle,
          currentPrompt,
        }),
      });

      if (!res.ok) {
        // Try to parse error JSON, fallback to status text
        let errMsg = "Failed to generate prompt";
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          /* ignore */
        }
        alert(errMsg);
        return null;
      }

      // Read the stream
      const reader = res.body?.getReader();
      if (!reader) return null;

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        onStream?.(accumulated);
      }

      setInstruction("");
      setShowInput(false);
      return accumulated;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setInstruction("");
    setShowInput(false);
    setLoading(false);
  };

  return { loading, instruction, setInstruction, showInput, setShowInput, generate, reset };
}

// ─── Prompt Assist UI Component ─────────────────────────────────────────────

function PromptAssistBar({
  assist,
  mode,
  roleTitle,
  currentPrompt,
  onUpdate,
}: {
  assist: ReturnType<typeof usePromptAssist>;
  mode: "generate" | "refine";
  roleTitle?: string;
  currentPrompt?: string;
  onUpdate: (prompt: string) => void;
}) {
  // Generate mode: one-click, stream into textarea
  const handleGenerate = async () => {
    const context = currentPrompt?.trim()
      ? `Role name: ${roleTitle || "Unknown"}\n\nExisting draft to expand upon:\n${currentPrompt}`
      : `Role name: ${roleTitle || "Unknown"}`;
    await assist.generate("generate", roleTitle, currentPrompt, context, onUpdate);
  };

  // Refine mode: needs user instruction, stream into textarea
  const handleRefine = async () => {
    await assist.generate("refine", roleTitle, currentPrompt, undefined, onUpdate);
  };

  if (mode === "generate") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleGenerate}
        disabled={!roleTitle?.trim() || assist.loading}
      >
        {assist.loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {assist.loading ? "Generating..." : "AI Generate"}
      </Button>
    );
  }

  // Refine mode
  if (!assist.showInput) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => assist.setShowInput(true)}
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI Refine
      </Button>
    );
  }

  return (
    <div className="flex gap-2 items-start rounded-md border border-primary/30 bg-primary/5 p-2">
      <Sparkles className="h-4 w-4 text-primary shrink-0 mt-1" />
      <div className="flex-1 min-w-0">
        <Input
          value={assist.instruction}
          onChange={(e) => assist.setInstruction(e.target.value)}
          placeholder="How to improve, e.g. 'Make it more concise' or 'Add error handling guidelines'"
          className="text-sm h-8"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !assist.loading) handleRefine();
            if (e.key === "Escape") assist.setShowInput(false);
          }}
          disabled={assist.loading}
        />
      </div>
      <Button
        size="sm"
        className="h-8 shrink-0"
        onClick={handleRefine}
        disabled={!assist.instruction.trim() || assist.loading}
      >
        {assist.loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          "Refine"
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0"
        onClick={() => assist.setShowInput(false)}
        disabled={assist.loading}
      >
        Cancel
      </Button>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

  // Env editor
  const [envContent, setEnvContent] = useState("");
  const [envOriginal, setEnvOriginal] = useState("");
  const [loadingEnv, setLoadingEnv] = useState(true);
  const [savingEnv, setSavingEnv] = useState(false);
  const [saved, setSaved] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newProvider, setNewProvider] = useState("openai");
  const [newModel, setNewModel] = useState("gpt-4o");

  // Edit dialog
  const [editRole, setEditRole] = useState<AgentRole | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [editModel, setEditModel] = useState("");
  const [saving, setSaving] = useState(false);

  // AI assist
  const createAssist = usePromptAssist();
  const editAssist = usePromptAssist();

  // Model capabilities
  const createCaps = useModelCapabilities();
  const editCaps = useModelCapabilities();

  const fetchRoles = () => {
    fetch("/api/roles")
      .then((res) => res.json())
      .then(setRoles)
      .finally(() => setLoadingRoles(false));
  };

  const fetchEnv = () => {
    setLoadingEnv(true);
    fetch("/api/env")
      .then((res) => res.json())
      .then((data) => {
        setEnvContent(data.content ?? "");
        setEnvOriginal(data.content ?? "");
      })
      .finally(() => setLoadingEnv(false));
  };

  useEffect(() => {
    fetchRoles();
    fetchEnv();
  }, []);

  const envDirty = envContent !== envOriginal;

  const handleSaveEnv = async () => {
    setSavingEnv(true);
    setSaved(false);
    try {
      const res = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: envContent }),
      });
      if (res.ok) {
        setEnvOriginal(envContent);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to save .env");
      }
    } finally {
      setSavingEnv(false);
    }
  };

  const openEdit = (role: AgentRole) => {
    const config = parseConfig(role.modelConfig);
    setEditRole(role);
    setEditTitle(role.title);
    setEditPrompt(role.systemPrompt);
    setEditProvider(config.provider ?? "openai");
    setEditModel(config.model ?? "");
    editAssist.reset();
    // Load existing or fetch capabilities
    if (config.inputModalities) {
      editCaps.setCaps({ inputModalities: config.inputModalities, outputModalities: config.outputModalities ?? ["text"] });
    } else {
      editCaps.fetchCaps(config.provider ?? "openai", config.model ?? "");
    }
  };

  const handleSaveEdit = async () => {
    if (!editRole || !editTitle || !editPrompt) return;
    setSaving(true);
    try {
      // Fetch latest capabilities before saving
      let capData = editCaps.caps;
      if (!capData) {
        capData = await editCaps.fetchCaps(editProvider, editModel);
      }
      const res = await fetch(`/api/roles/${editRole.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          systemPrompt: editPrompt,
          modelConfig: {
            provider: editProvider,
            model: editModel,
            inputModalities: capData?.inputModalities ?? ["text"],
            outputModalities: capData?.outputModalities ?? ["text"],
          },
        }),
      });
      if (res.ok) {
        setEditRole(null);
        fetchRoles();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update role");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newTitle || !newPrompt) return;
    setCreating(true);
    const autoName = crypto.randomUUID();
    try {
      // Fetch capabilities before saving
      let capData = createCaps.caps;
      if (!capData) {
        capData = await createCaps.fetchCaps(newProvider, newModel);
      }
      const res = await fetch("/api/roles/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: autoName,
          title: newTitle,
          systemPrompt: newPrompt,
          modelConfig: {
            provider: newProvider,
            model: newModel,
            inputModalities: capData?.inputModalities ?? ["text"],
            outputModalities: capData?.outputModalities ?? ["text"],
          },
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        setNewTitle("");
        setNewPrompt("");
        createAssist.reset();
        createCaps.setCaps(null);
        fetchRoles();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create role");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <Header
        title="Settings"
        description="Configure LLM providers and manage agent roles"
      />

      <div className="p-6 max-w-4xl">
        <Tabs defaultValue="providers">
          <TabsList>
            <TabsTrigger value="providers">
              <Key className="h-4 w-4 mr-1" />
              LLM Providers
            </TabsTrigger>
            <TabsTrigger value="roles">
              <Users className="h-4 w-4 mr-1" />
              Agent Roles
            </TabsTrigger>
          </TabsList>

          {/* LLM Providers Tab */}
          <TabsContent value="providers" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Environment Variables
                </CardTitle>
                <CardDescription>
                  Edit your{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    .env
                  </code>{" "}
                  file directly. Changes take effect immediately after saving.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingEnv ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading...
                  </div>
                ) : (
                  <>
                    <Textarea
                      value={envContent}
                      onChange={(e) => setEnvContent(e.target.value)}
                      className="font-mono text-sm min-h-[280px] leading-relaxed"
                      spellCheck={false}
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {saved ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            Saved — env vars reloaded
                          </span>
                        ) : envDirty ? (
                          <span className="text-yellow-600">
                            Unsaved changes
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            No changes
                          </span>
                        )}
                      </div>
                      <Button
                        onClick={handleSaveEnv}
                        disabled={!envDirty || savingEnv}
                        size="sm"
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {savingEnv ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Provider API Key References
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {llmProviders.map((p) => (
                    <a
                      key={p.envKey}
                      href={p.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm hover:bg-accent transition-colors"
                    >
                      {p.name}
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Agent Roles Tab */}
          <TabsContent value="roles" className="space-y-6 mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Agent Roles
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Click any role to edit its prompt and model configuration
                  </CardDescription>
                </div>
                <Dialog
                  open={createOpen}
                  onOpenChange={(open) => {
                    setCreateOpen(open);
                    if (!open) createAssist.reset();
                  }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Custom Role
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Create Custom Role</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div>
                        <label className="text-sm font-medium">Role Name</label>
                        <Input
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder="e.g. DevOps Engineer"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-sm font-medium">
                            System Prompt
                          </label>
                          <PromptAssistBar
                            assist={createAssist}
                            mode={newPrompt.trim() ? "refine" : "generate"}
                            roleTitle={newTitle}
                            currentPrompt={newPrompt}
                            onUpdate={setNewPrompt}
                          />
                        </div>
                        <Textarea
                          value={newPrompt}
                          onChange={(e) => setNewPrompt(e.target.value)}
                          placeholder="Define the role's expertise, responsibilities, and working style... or use AI Generate above."
                          className="mt-1 font-mono text-sm"
                          rows={12}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm font-medium">
                            Provider
                          </label>
                          <Select
                            value={newProvider}
                            onValueChange={(v) => {
                              setNewProvider(v);
                              if (newModel) createCaps.fetchCaps(v, newModel);
                            }}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {providerOptions.map((p) => (
                                <SelectItem key={p.value} value={p.value}>
                                  {p.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Model</label>
                          <Input
                            value={newModel}
                            onChange={(e) => setNewModel(e.target.value)}
                            onBlur={() => {
                              if (newModel && newProvider) createCaps.fetchCaps(newProvider, newModel);
                            }}
                            placeholder="gpt-4o"
                            className="mt-1"
                          />
                        </div>
                      </div>
                      {/* Model capabilities preview */}
                      {createCaps.loading && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Detecting model capabilities...
                        </p>
                      )}
                      {createCaps.caps && !createCaps.loading && (
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs font-medium mb-1.5">Model Capabilities</p>
                          <ModalityBadges
                            input={createCaps.caps.inputModalities}
                            output={createCaps.caps.outputModalities}
                          />
                        </div>
                      )}
                      <Button
                        onClick={handleCreateRole}
                        disabled={!newTitle || !newPrompt || creating}
                        className="w-full"
                      >
                        {creating ? "Creating..." : "Create Role"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingRoles ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading roles...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {roles.map((role) => {
                      const config = parseConfig(role.modelConfig);
                      return (
                        <div
                          key={role.id}
                          className="flex items-center gap-4 p-4 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer"
                          onClick={() => openEdit(role)}
                        >
                          <div className="shrink-0 min-w-[160px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{role.title}</span>
                              {role.isBuiltin && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  Built-in
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {config.provider} / {config.model}
                            </p>
                            <ModalityBadges
                              input={config.inputModalities}
                              output={config.outputModalities}
                            />
                          </div>
                          <div className="flex-1 min-w-0 rounded-md bg-muted/50 border border-dashed px-3 py-2">
                            <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                              {role.systemPrompt}
                            </p>
                          </div>
                          <Pencil className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Role Dialog */}
      <Dialog
        open={editRole !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditRole(null);
            editAssist.reset();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Role: {editRole?.title}</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{editRole?.name}</span>
              {editRole?.isBuiltin && " · Built-in role"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Display Name</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">System Prompt</label>
                <PromptAssistBar
                  assist={editAssist}
                  mode="refine"
                  roleTitle={editTitle}
                  currentPrompt={editPrompt}
                  onUpdate={setEditPrompt}
                />
              </div>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                className="mt-1 font-mono text-sm"
                rows={14}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Provider</label>
                <Select
                  value={editProvider}
                  onValueChange={(v) => {
                    setEditProvider(v);
                    if (editModel) editCaps.fetchCaps(v, editModel);
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providerOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Model</label>
                <Input
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  onBlur={() => {
                    if (editModel && editProvider) editCaps.fetchCaps(editProvider, editModel);
                  }}
                  className="mt-1"
                />
              </div>
            </div>
            {/* Model capabilities preview */}
            {editCaps.loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Detecting model capabilities...
              </p>
            )}
            {editCaps.caps && !editCaps.loading && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium mb-1.5">Model Capabilities</p>
                <ModalityBadges
                  input={editCaps.caps.inputModalities}
                  output={editCaps.caps.outputModalities}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditRole(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={!editTitle || !editPrompt || saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
