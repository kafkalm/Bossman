"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { useTranslation } from "@/lib/i18n";
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
  Settings,
  Layers,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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
  skills?: { skill: { id: string; name: string } }[];
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

function ModalityBadges({ input, output, t }: { input?: string[]; output?: string[]; t: (k: string) => string }) {
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
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">{t("settings.input")}</span>
          {input.map((m) => renderBadge(m))}
        </div>
      )}
      {output && output.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground w-10 shrink-0">{t("settings.output")}</span>
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
  const { t } = useTranslation();
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
        {assist.loading ? t("settings.generating") : t("settings.aiGenerate")}
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
        {t("settings.aiRefine")}
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
          placeholder={t("settings.refinePlaceholder")}
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
          t("settings.refine")
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0"
        onClick={() => assist.setShowInput(false)}
        disabled={assist.loading}
      >
        {t("common.cancel")}
      </Button>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t, locale, setLocale } = useTranslation();
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
  const [allSkillsList, setAllSkillsList] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [editRoleSkillIds, setEditRoleSkillIds] = useState<Set<string>>(new Set());
  const [loadingRoleSkills, setLoadingRoleSkills] = useState(false);
  const [editSkillSearch, setEditSkillSearch] = useState("");

  // Batch edit
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchSkillIds, setBatchSkillIds] = useState<Set<string>>(new Set());
  const [batchProvider, setBatchProvider] = useState("");
  const [batchModel, setBatchModel] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchAllSkills, setBatchAllSkills] = useState<{ id: string; name: string; description: string | null }[]>([]);
  const [batchSkillSearch, setBatchSkillSearch] = useState("");

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
        alert(err.error || t("settings.failedSave"));
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
    setLoadingRoleSkills(true);
    Promise.all([
      fetch("/api/skills").then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/roles/${role.id}/skills`).then((r) => (r.ok ? r.json() : { skills: [] })),
    ]).then(([skills, { skills: roleSkills }]) => {
      setAllSkillsList(skills);
      setEditRoleSkillIds(new Set((roleSkills as { id: string }[]).map((s) => s.id)));
      setLoadingRoleSkills(false);
    }).catch(() => setLoadingRoleSkills(false));
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
        await fetch(`/api/roles/${editRole.id}/skills`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillIds: Array.from(editRoleSkillIds) }),
        });
        setEditRole(null);
        fetchRoles();
      } else {
        const err = await res.json();
        alert(err.error || t("settings.failedUpdate"));
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleRoleSelection = (roleId: string) => {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const selectAllRoles = (checked: boolean) => {
    if (checked) setSelectedRoleIds(new Set(roles.map((r) => r.id)));
    else setSelectedRoleIds(new Set());
  };

  const handleBatchApply = async () => {
    const roleIds = Array.from(selectedRoleIds);
    const payload: {
      roleIds: string[];
      skillIds?: string[];
      skillMode?: "add" | "replace";
      modelConfig?: Record<string, unknown>;
    } = { roleIds };
    if (batchSkillIds.size > 0) {
      payload.skillIds = Array.from(batchSkillIds);
      payload.skillMode = "add";
    }
    if (batchProvider && batchModel) {
      payload.modelConfig = { provider: batchProvider, model: batchModel };
    }
    if (!payload.skillIds && !payload.modelConfig) return;
    setBatchSaving(true);
    try {
      const res = await fetch("/api/roles/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setBatchEditOpen(false);
        setSelectedRoleIds(new Set());
        setBatchSkillIds(new Set());
        setBatchProvider("");
        setBatchModel("");
        fetchRoles();
        alert(t("settings.batchSuccess"));
      } else {
        const err = await res.json();
        alert(err.error || t("settings.batchError"));
      }
    } finally {
      setBatchSaving(false);
    }
  };

  const handleBatchClearSkills = async () => {
    if (!confirm(t("settings.clearSkillsConfirm"))) return;
    const roleIds = Array.from(selectedRoleIds);
    setBatchSaving(true);
    try {
      const res = await fetch("/api/roles/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds, skillIds: [], skillMode: "replace" }),
      });
      if (res.ok) {
        setBatchEditOpen(false);
        setSelectedRoleIds(new Set());
        setBatchSkillIds(new Set());
        fetchRoles();
        alert(t("settings.batchSuccess"));
      } else {
        const err = await res.json();
        alert(err.error || t("settings.batchError"));
      }
    } finally {
      setBatchSaving(false);
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
        alert(err.error || t("settings.failedCreate"));
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <Header
        title={t("settings.title")}
        description={t("settings.description")}
      />

      <div className="p-6 max-w-4xl">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">
              <Settings className="h-4 w-4 mr-1" />
              {t("settings.language")}
            </TabsTrigger>
            <TabsTrigger value="providers">
              <Key className="h-4 w-4 mr-1" />
              {t("settings.llmProviders")}
            </TabsTrigger>
            <TabsTrigger value="roles">
              <Users className="h-4 w-4 mr-1" />
              {t("settings.agentRoles")}
            </TabsTrigger>
          </TabsList>

          {/* General / Language */}
          <TabsContent value="general" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.language")}</CardTitle>
                <CardDescription>{t("settings.languageDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={locale}
                  onValueChange={(v) => setLocale(v as "en" | "zh")}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{t("settings.english")}</SelectItem>
                    <SelectItem value="zh">{t("settings.chinese")}</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          </TabsContent>

          {/* LLM Providers Tab */}
          <TabsContent value="providers" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  {t("settings.envVars")}
                </CardTitle>
                <CardDescription>
                  {t("settings.envDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingEnv ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("settings.loading")}
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
                            {t("settings.savedReloaded")}
                          </span>
                        ) : envDirty ? (
                          <span className="text-yellow-600">
                            {t("common.unsavedChanges")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("common.noChanges")}
                          </span>
                        )}
                      </div>
                      <Button
                        onClick={handleSaveEnv}
                        disabled={!envDirty || savingEnv}
                        size="sm"
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {savingEnv ? t("settings.saving") : t("common.save")}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("settings.providerApiKeys")}
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
                    {t("settings.agentRoles")}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {t("settings.clickToEdit")}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedRoleIds.size === 0}
                    onClick={() => {
                      setBatchEditOpen(true);
                      fetch("/api/skills")
                        .then((r) => (r.ok ? r.json() : []))
                        .then(setBatchAllSkills)
                        .catch(() => setBatchAllSkills([]));
                    }}
                  >
                    <Layers className="h-4 w-4 mr-1" />
                    {t("settings.batchEdit")}
                    {selectedRoleIds.size > 0 && ` (${selectedRoleIds.size})`}
                  </Button>
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
                        {t("settings.customRole")}
                      </Button>
                    </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{t("settings.createCustomRole")}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div>
                        <label className="text-sm font-medium">{t("settings.roleName")}</label>
                        <Input
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          placeholder={t("settings.roleNamePlaceholder")}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-sm font-medium">
                            {t("settings.systemPrompt")}
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
                          placeholder={t("settings.systemPromptPlaceholder")}
                          className="mt-1 font-mono text-sm"
                          rows={12}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm font-medium">
                            {t("settings.provider")}
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
                          <label className="text-sm font-medium">{t("settings.model")}</label>
                          <Input
                            value={newModel}
                            onChange={(e) => setNewModel(e.target.value)}
                            onBlur={() => {
                              if (newModel && newProvider) createCaps.fetchCaps(newProvider, newModel);
                            }}
                            placeholder={t("settings.modelPlaceholder")}
                            className="mt-1"
                          />
                        </div>
                      </div>
                      {/* Model capabilities preview */}
                      {createCaps.loading && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("settings.detectingCapabilities")}
                        </p>
                      )}
                      {createCaps.caps && !createCaps.loading && (
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs font-medium mb-1.5">{t("settings.modelCapabilities")}</p>
                          <ModalityBadges
                            input={createCaps.caps.inputModalities}
                            output={createCaps.caps.outputModalities}
                            t={t}
                          />
                        </div>
                      )}
                      <Button
                        onClick={handleCreateRole}
                        disabled={!newTitle || !newPrompt || creating}
                        className="w-full"
                      >
                        {creating ? t("settings.creating") : t("settings.createRole")}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {loadingRoles ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("settings.loadingRoles")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 px-4 py-2 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={roles.length > 0 && selectedRoleIds.size === roles.length}
                          onCheckedChange={(c) => selectAllRoles(c === true)}
                        />
                        <span className="text-xs text-muted-foreground">{t("common.selectAll")}</span>
                      </div>
                      <div className="min-w-[140px]" />
                    </div>
                    {roles.map((role) => {
                      const config = parseConfig(role.modelConfig);
                      return (
                        <div
                          key={role.id}
                          className="flex items-center gap-4 p-4 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer"
                          onClick={() => openEdit(role)}
                        >
                          <div
                            className="shrink-0 flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={selectedRoleIds.has(role.id)}
                              onCheckedChange={() => toggleRoleSelection(role.id)}
                            />
                          </div>
                          <div className="shrink-0 min-w-[140px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{role.title}</span>
                              {role.isBuiltin && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {t("settings.builtinRole")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 mb-2">
                              {config.provider} / {config.model}
                            </p>
                            <ModalityBadges
                              input={config.inputModalities ?? ["text"]}
                              output={config.outputModalities ?? ["text"]}
                              t={t}
                            />
                            {role.skills && role.skills.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-2">
                                <Sparkles className="h-3 w-3 text-muted-foreground shrink-0" />
                                {role.skills.map(({ skill }) => (
                                  <Badge
                                    key={skill.id}
                                    variant="outline"
                                    className="text-[10px] font-normal py-0 px-1.5"
                                  >
                                    {skill.name}
                                  </Badge>
                                ))}
                              </div>
                            )}
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
            setEditSkillSearch("");
            editAssist.reset();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("settings.editRole")}: {editRole?.title}</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{editRole?.name}</span>
              {editRole?.isBuiltin && ` · ${t("settings.builtinRole")}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2 min-w-0">
            <div>
              <label className="text-sm font-medium">{t("settings.displayName")}</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">{t("settings.systemPrompt")}</label>
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
                <label className="text-sm font-medium">{t("settings.provider")}</label>
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
                <label className="text-sm font-medium">{t("settings.model")}</label>
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
                  t={t}
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                {t("skills.configureForRole")}
              </label>
              {loadingRoleSkills ? (
                <p className="text-xs text-muted-foreground mt-1">{t("common.loading")}</p>
              ) : allSkillsList.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">{t("skills.noSkills")}</p>
              ) : (
                <>
                  <Input
                    placeholder={t("common.search")}
                    value={editSkillSearch}
                    onChange={(e) => setEditSkillSearch(e.target.value)}
                    className="mt-2 h-8 text-sm"
                  />
                  <div className="max-h-40 min-w-0 w-full overflow-auto rounded border mt-2 p-2 space-y-1.5">
                  {allSkillsList
                    .filter(
                      (s) =>
                        !editSkillSearch.trim() ||
                        s.name.toLowerCase().includes(editSkillSearch.trim().toLowerCase()) ||
                        (s.description ?? "").toLowerCase().includes(editSkillSearch.trim().toLowerCase())
                    )
                    .map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 cursor-pointer rounded p-1.5 hover:bg-muted/50 min-w-0"
                    >
                      <Checkbox
                        className="shrink-0"
                        checked={editRoleSkillIds.has(s.id)}
                        onCheckedChange={() => {
                          setEditRoleSkillIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          });
                        }}
                      />
                      <span className="text-sm font-medium shrink-0">{s.name}</span>
                      {s.description && (
                        <span className="text-xs text-muted-foreground truncate min-w-0">
                          {s.description}
                        </span>
                      )}
                    </label>
                  ))}
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditRole(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={!editTitle || !editPrompt || saving}
              >
                {saving ? t("settings.saving") : t("settings.saveChanges")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch Edit Roles Dialog */}
      <Dialog
        open={batchEditOpen}
        onOpenChange={(open) => {
          setBatchEditOpen(open);
          if (!open) setBatchSkillSearch("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.batchEditRoles")}</DialogTitle>
            <DialogDescription>
              {t("settings.selectedCount").replace("{{count}}", String(selectedRoleIds.size))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2 min-w-0">
            <div>
              <label className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                {t("settings.applySkillsToSelected")}
              </label>
              {batchAllSkills.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">{t("skills.noSkills")}</p>
              ) : (
                <>
                  <Input
                    placeholder={t("common.search")}
                    value={batchSkillSearch}
                    onChange={(e) => setBatchSkillSearch(e.target.value)}
                    className="mt-2 h-8 text-sm"
                  />
                  <div className="max-h-40 min-w-0 w-full overflow-auto rounded border mt-2 p-2 space-y-1.5">
                  {batchAllSkills
                    .filter(
                      (s) =>
                        !batchSkillSearch.trim() ||
                        s.name.toLowerCase().includes(batchSkillSearch.trim().toLowerCase()) ||
                        (s.description ?? "").toLowerCase().includes(batchSkillSearch.trim().toLowerCase())
                    )
                    .map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 cursor-pointer rounded p-1.5 hover:bg-muted/50 min-w-0"
                    >
                      <Checkbox
                        className="shrink-0"
                        checked={batchSkillIds.has(s.id)}
                        onCheckedChange={() => {
                          setBatchSkillIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          });
                        }}
                      />
                      <span className="text-sm font-medium shrink-0">{s.name}</span>
                      {s.description && (
                        <span className="text-xs text-muted-foreground truncate min-w-0">{s.description}</span>
                      )}
                    </label>
                  ))}
                  </div>
                </>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">{t("settings.applyModelToSelected")}</label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <Select
                    value={batchProvider ? batchProvider : "__none__"}
                    onValueChange={(v) => setBatchProvider(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("settings.provider")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {providerOptions.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Input
                    value={batchModel}
                    onChange={(e) => setBatchModel(e.target.value)}
                    placeholder={t("settings.modelPlaceholder")}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleBatchClearSkills}
                disabled={batchSaving || selectedRoleIds.size === 0}
              >
                {t("settings.clearSkills")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setBatchEditOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleBatchApply}
                  disabled={
                    batchSaving ||
                    (batchSkillIds.size === 0 && (!batchProvider || !batchModel))
                  }
                >
                  {batchSaving ? t("settings.saving") : t("settings.applyToSelected")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
