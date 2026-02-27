"use client";

import { useEffect, useState, useRef, use, useCallback } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Send,
  User,
  Bot,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Circle,
  Info,
  Pause,
  Play,
  FileText,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  GripVertical,
  Coins,
  Code2,
  Expand,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getEmployeeStatusColor, getProjectStatusColor } from "@/lib/constants";
import { useTranslation } from "@/lib/i18n";
import { sanitizeDocumentContent } from "@/lib/sanitize-document";

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  output: string | null;
  assignments: {
    employee: {
      id: string;
      name: string;
      role: { title: string };
    };
  }[];
  subTasks: Task[];
}

interface Message {
  id: string;
  senderType: string;
  content: string;
  metadata: string | null;
  createdAt: string;
  taskId: string | null;
  sender: {
    id: string;
    name: string;
    role: { title: string };
  } | null;
}

interface ProjectFile {
  id: string;
  title: string;
  path?: string | null;
  content: string;
  brief: string | null;
  fileType?: string;
  createdAt: string;
  employee: {
    id: string;
    name: string;
    role: { title: string };
  };
  task: { id: string; title: string } | null;
}

interface Employee {
  id: string;
  name: string;
  status: string;
  role: { name: string; title: string };
}

interface Project {
  id: string;
  name: string;
  description: string;
  document: string | null;
  status: string;
  company: {
    id: string;
    name: string;
    employees: Employee[];
  };
  tasks: Task[];
  messages: Message[];
  files: ProjectFile[];
  tokenCount?: number;
}

type TimelineEvent = {
  id: string;
  projectId: string;
  taskId: string | null;
  eventType: string;
  actor: string;
  summary: string;
  payload: string | null;
  createdAt: string;
};

type TimelineLane = {
  employeeId: string;
  name: string;
  roleTitle: string;
  lastActiveAt: number;
};

const TIMELINE_CARD_WIDTH = 320;
const TIMELINE_CARD_HEIGHT = 148;
const TIMELINE_ROW_MIN_HEIGHT = 164;
const TIMELINE_LANE_WIDTH = TIMELINE_CARD_WIDTH + 24;

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3.5 w-3.5 text-gray-400" />,
  assigned: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
  in_progress: <Circle className="h-3.5 w-3.5 text-blue-500" />,
  review: <AlertCircle className="h-3.5 w-3.5 text-purple-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  blocked: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  assigned: "outline",
  in_progress: "default",
  review: "outline",
  completed: "default",
  blocked: "destructive",
  planning: "secondary",
  failed: "destructive",
};

export default function ProjectDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(props.params);
  const { t } = useTranslation();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("");
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedProjectDoc, setSelectedProjectDoc] = useState(false);
  const [selectedCodeFileId, setSelectedCodeFileId] = useState<string | null>(
    null
  );
  const [expandedCodeEmployeeIds, setExpandedCodeEmployeeIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [docTreeWidth, setDocTreeWidth] = useState(224);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; w: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineItemsRef = useRef<TimelineEvent[]>([]);

  const [timelineItems, setTimelineItems] = useState<TimelineEvent[]>([]);
  const [timelineOldestCursor, setTimelineOldestCursor] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoadingOlder, setTimelineLoadingOlder] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineHasNew, setTimelineHasNew] = useState(false);
  const [timelineNewCount, setTimelineNewCount] = useState(0);
  const [timelineInitializedScrollRight, setTimelineInitializedScrollRight] = useState(false);
  const [timelineBootstrapped, setTimelineBootstrapped] = useState(false);
  const [projectStatusChanging, setProjectStatusChanging] = useState(false);
  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    timelineItemsRef.current = timelineItems;
  }, [timelineItems]);

  const fetchTimelinePage = useCallback(async (opts?: { cursor?: string; limit?: number; direction?: "older" | "newer" }) => {
    const limit = opts?.limit ?? 30;
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.cursor) params.set("cursor", opts.cursor);
    params.set("direction", opts?.direction ?? "older");

    const res = await fetch(`/api/projects/${id}/timeline?${params.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || "Failed to load timeline");
    }
    const data = (await res.json()) as {
      items?: TimelineEvent[];
      nextCursor?: string | null;
    };
    return {
      items: Array.isArray(data.items) ? data.items : [],
      nextCursor: data.nextCursor ?? null,
    };
  }, [id]);

  const fetchTimelineFirstPage = useCallback(async () => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const data = await fetchTimelinePage({ limit: 30, direction: "older" });
      const normalized = sortTimelineEventsAsc(data.items);
      setTimelineItems((prev) => mergeTimelineEvents(normalized, prev));
      setTimelineOldestCursor(data.nextCursor);
      setTimelineHasNew(false);
      setTimelineNewCount(0);
      setTimelineInitializedScrollRight(false);
      setTimelineBootstrapped(true);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Failed to load timeline");
    } finally {
      setTimelineLoading(false);
    }
  }, [fetchTimelinePage]);

  const fetchTimelineOlderPage = useCallback(async () => {
    if (!timelineOldestCursor || timelineLoadingOlder) return;
    const viewport = timelineViewportRef.current;
    const prevWidth = viewport?.scrollWidth ?? 0;
    const prevLeft = viewport?.scrollLeft ?? 0;
    setTimelineLoadingOlder(true);
    setTimelineError(null);
    try {
      const data = await fetchTimelinePage({
        cursor: timelineOldestCursor,
        limit: 30,
        direction: "older",
      });
      setTimelineItems((prev) => {
        const merged = mergeTimelineEvents(sortTimelineEventsAsc(data.items), prev);
        return merged;
      });
      setTimelineOldestCursor(data.nextCursor);
      requestAnimationFrame(() => {
        const el = timelineViewportRef.current;
        if (!el) return;
        const widthDelta = el.scrollWidth - prevWidth;
        el.scrollLeft = prevLeft + Math.max(0, widthDelta);
      });
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Failed to load timeline");
    } finally {
      setTimelineLoadingOlder(false);
    }
  }, [fetchTimelinePage, timelineLoadingOlder, timelineOldestCursor]);

  const applyNewTimelineEvents = useCallback(() => {
    if (!timelineHasNew) return;
    setTimelineHasNew(false);
    setTimelineNewCount(0);
    requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = viewport.scrollWidth;
    });
  }, [timelineHasNew]);

  useEffect(() => {
    fetchProject();
    // SSE for real-time file/doc updates
    const es = new EventSource(`/api/projects/${id}/events`);
    es.addEventListener("refresh", () => fetchProject());
    const onTimelineEvent = (evt: MessageEvent<string>) => {
      const incoming = parseTimelineEventFromSSE(id, evt);
      if (!incoming) return;
      const incomingKey = getTimelineEventKey(incoming);
      let added = false;
      setTimelineItems((prev) => {
        const existingMap = new Set(prev.map(getTimelineEventKey));
        if (existingMap.has(incomingKey)) return prev;
        added = true;
        return mergeTimelineEvents(prev, [incoming]);
      });
      if (!added) {
        const fallbackExistingMap = new Set(timelineItemsRef.current.map(getTimelineEventKey));
        if (fallbackExistingMap.has(incomingKey)) return;
      }
      setTimelineHasNew(true);
      setTimelineNewCount((n) => n + 1);
    };
    es.addEventListener("project.updated", onTimelineEvent as EventListener);
    es.addEventListener("task.updated", onTimelineEvent as EventListener);
    es.addEventListener("task.transitioned", onTimelineEvent as EventListener);
    es.addEventListener("engine.alert", onTimelineEvent as EventListener);
    return () => {
      es.close();
    };
  }, [fetchProject, id]);

  // Resize document tree
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = e.clientX - start.x;
      const next = Math.max(180, Math.min(480, start.w + delta));
      setDocTreeWidth(next);
    };
    const onUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartRef.current = { x: e.clientX, w: docTreeWidth };
    setIsResizing(true);
  }, [docTreeWidth]);

  const scrollChatToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollChatToBottom();
  }, [project?.messages?.length, scrollChatToBottom]);

  useEffect(() => {
    if (!project) return;
    const docFiles = (project.files ?? []).filter(
      (f) => (f.fileType ?? "document") === "document"
    );
    const codeFiles = (project.files ?? []).filter((f) => f.fileType === "code");
    const hasDocFiles = !!project.document || docFiles.length > 0;
    const hasCodeFiles = codeFiles.length > 0;
    const effectiveTab =
      activeTab ||
      (hasDocFiles || hasCodeFiles ? "workspace" : "chat");
    if (effectiveTab === "chat") {
      const t1 = setTimeout(scrollChatToBottom, 0);
      const t2 = setTimeout(scrollChatToBottom, 150);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [activeTab, project, scrollChatToBottom]);

  useEffect(() => {
    if (activeTab !== "workspace") return;
    const fileId = selectedFileId || selectedCodeFileId;
    if (fileId) {
      const file = project?.files?.find((f) => f.id === fileId);
      if (file) {
        if (file.fileType === "code") {
          setExpandedCodeEmployeeIds((prev) =>
            new Set(prev).add(file.employee.id)
          );
        } else {
          setExpandedEmployeeIds((prev) =>
            new Set(prev).add(file.employee.id)
          );
        }
      }
      const el = document.getElementById(fileId);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeTab, selectedFileId, selectedCodeFileId, project?.files]);

  useEffect(() => {
    if (activeTab !== "timeline") return;
    if (!timelineBootstrapped && !timelineLoading) {
      void fetchTimelineFirstPage();
    }
  }, [activeTab, fetchTimelineFirstPage, timelineBootstrapped, timelineLoading]);

  useEffect(() => {
    if (activeTab !== "timeline") return;
    if (timelineLoading || timelineItems.length === 0 || timelineInitializedScrollRight) return;
    requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = viewport.scrollWidth;
      setTimelineInitializedScrollRight(true);
    });
  }, [activeTab, timelineItems.length, timelineLoading, timelineInitializedScrollRight]);

  const handleTimelineScroll = useCallback(() => {
    if (activeTab !== "timeline") return;
    const viewport = timelineViewportRef.current;
    if (!viewport || timelineLoading) return;

    const nearLeft = viewport.scrollLeft < 180;

    if (nearLeft && timelineOldestCursor && !timelineLoadingOlder) {
      void fetchTimelineOlderPage();
    }
  }, [
    activeTab,
    fetchTimelineOlderPage,
    timelineLoading,
    timelineLoadingOlder,
    timelineOldestCursor,
  ]);

  const handleSendMessage = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/projects/${id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
      setMessage("");
      setTimeout(fetchProject, 1000);
    } finally {
      setSending(false);
    }
  };

  const handleProjectExecutionToggle = useCallback(async () => {
    if (!project || projectStatusChanging) return;
    const normalized = normalizeTaskStatus(project.status);
    const action = normalized === "paused" ? "start" : "pause";
    setProjectStatusChanging(true);
    try {
      const res = await fetch(`/api/projects/${id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to ${action} project`);
      }
      await fetchProject();
    } catch (error) {
      console.error(error);
    } finally {
      setProjectStatusChanging(false);
    }
  }, [fetchProject, id, project, projectStatusChanging]);

  if (loading) {
    return (
      <div>
        <Header title="Loading..." />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div>
        <Header title="Not Found" />
        <div className="p-6 text-center">Project not found.</div>
      </div>
    );
  }

  const allTasks = flattenTasks(project.tasks ?? []);
  // 团队列表只显示为当前项目工作的员工：在本项目中有任务分配的 + CEO
  const projectTeamEmployeeIds = new Set<string>(
    allTasks.flatMap((t) => (t.assignments ?? []).map((a) => a.employee.id))
  );
  const ceo = project.company.employees.find((e) => e.role.name === "ceo");
  if (ceo) projectTeamEmployeeIds.add(ceo.id);
  const projectTeamEmployees = project.company.employees.filter((e) =>
    projectTeamEmployeeIds.has(e.id)
  );
  const timelineLanes = buildProjectTimelineLanes(
    project.company.employees,
    projectTeamEmployees,
    timelineItems
  );
  const taskAssigneeById = buildTaskAssigneeMap(allTasks);
  const timelineLaneEvents = buildTimelineLaneEvents(
    project.company.employees,
    timelineLanes,
    timelineItems,
    taskAssigneeById
  );
  const taskTitleById = buildTaskTitleMap(allTasks);

  const completedTasks = allTasks.filter(
    (t) => normalizeTaskStatus(t.status) === "done"
  );
  const progressPercent =
    allTasks.length > 0
      ? Math.round((completedTasks.length / allTasks.length) * 100)
      : 0;

  // Group tasks by normalized status for kanban (must match DB: todo, in_progress, review, done, blocked, canceled)
  const kanbanStatusOrder = [
    "todo",
    "in_progress",
    "review",
    "done",
    "blocked",
    "canceled",
  ] as const;
  const tasksByStatus: Record<string, Task[]> = Object.fromEntries(
    kanbanStatusOrder.map((s) => [s, []])
  ) as Record<string, Task[]>;
  for (const task of allTasks) {
    const normalizedStatus = normalizeTaskStatus(task.status);
    const group =
      tasksByStatus[normalizedStatus] ?? tasksByStatus.todo;
    group.push(task);
  }

  const hasDocument = !!project.document;
  const projectFiles = project.files ?? [];
  const docFiles = projectFiles.filter(
    (f) => (f.fileType ?? "document") === "document"
  );
  const codeFiles = projectFiles.filter((f) => f.fileType === "code");
  const hasFiles = projectFiles.length > 0;
  const hasDocFiles = hasDocument || docFiles.length > 0;
  const hasCodeFiles = codeFiles.length > 0;
  const defaultTab =
    activeTab ||
    (hasDocFiles || hasCodeFiles ? "workspace" : "chat");

  const handleViewFile = (fileId: string) => {
    const file = projectFiles.find((f) => f.id === fileId);
    if (file?.fileType === "code") {
      setActiveTab("workspace");
      setSelectedProjectDoc(false);
      setSelectedFileId(null);
      setSelectedCodeFileId(fileId);
      setExpandedCodeEmployeeIds((prev) =>
        new Set(prev).add(file.employee.id)
      );
    } else if (file) {
      setActiveTab("workspace");
      setSelectedProjectDoc(false);
      setSelectedFileId(fileId);
      setSelectedCodeFileId(null);
      setExpandedEmployeeIds((prev) =>
        new Set(prev).add(file.employee.id)
      );
    }
  };

  const toggleCodeEmployeeFolder = (employeeId: string) => {
    setExpandedCodeEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const toggleEmployeeFolder = (employeeId: string) => {
    setExpandedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-screen">
      <Header
        title={project.name}
        description={project.description || undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleProjectExecutionToggle}
              disabled={projectStatusChanging || normalizeTaskStatus(project.status) === "done" || normalizeTaskStatus(project.status) === "canceled"}
            >
              {projectStatusChanging ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : normalizeTaskStatus(project.status) === "paused" ? (
                <Play className="h-4 w-4 mr-1" />
              ) : (
                <Pause className="h-4 w-4 mr-1" />
              )}
              {normalizeTaskStatus(project.status) === "paused" ? "Resume" : "Pause"}
            </Button>
            <Badge variant="outline" className={getProjectStatusColor(project.status)}>
              {t(`taskStatus.${project.status}`)}
            </Badge>
            <Link href="/project">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Projects
              </Button>
            </Link>
          </div>
        }
      />

      {/* Progress bar and token count */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
          <span className="flex items-center gap-3">
            {allTasks.length > 0 && (
              <span>
                {t("project.progress")}: {completedTasks.length} / {allTasks.length} tasks
              </span>
            )}
            <span className="flex items-center gap-1">
              <Coins className="h-3.5 w-3.5" />
              {(project.tokenCount ?? 0).toLocaleString()} {t("project.tokens")}
            </span>
          </span>
          {allTasks.length > 0 && <span>{progressPercent}%</span>}
        </div>
        {allTasks.length > 0 && <Progress value={progressPercent} className="h-2" />}
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs
          value={defaultTab}
          onValueChange={(v) => {
            setActiveTab(v);
            if (v === "chat") {
              setTimeout(() => scrollChatToBottom(), 0);
              setTimeout(() => scrollChatToBottom(), 150);
            }
          }}
          className="flex flex-col h-full"
        >
          <div className="border-b px-6">
            <TabsList className="h-10">
              <TabsTrigger value="workspace" className="gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                {t("project.workspaceTab")}
                {(!hasDocument && allTasks.length > 0) && (
                  <Loader2 className="h-3 w-3 animate-spin ml-1" />
                )}
                {((hasDocument ? 1 : 0) + docFiles.length + codeFiles.length) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({(hasDocument ? 1 : 0) + docFiles.length + codeFiles.length})
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="chat">
                {t("project.chat")} ({(project.messages ?? []).length})
              </TabsTrigger>
              <TabsTrigger value="kanban">
                {t("project.kanban")} ({allTasks.length})
              </TabsTrigger>
              <TabsTrigger value="timeline">
                {t("project.timeline")}
              </TabsTrigger>
              <TabsTrigger value="team">{t("project.team")}</TabsTrigger>
            </TabsList>
          </div>

          {/* Workspace Tab: document + code in one tree, single preview */}
          <TabsContent
            value="workspace"
            className="flex-1 m-0 flex flex-col min-h-0"
          >
            <div className="flex flex-1 min-h-0">
              {/* Left: unified workspace tree */}
              <aside
                className="shrink-0 border-r bg-muted/30 flex flex-col min-h-0"
                style={{ width: docTreeWidth }}
              >
                <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">
                  {t("project.workspaceDirectoryTitle")}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto py-2">
                  <div className="px-1 space-y-0.5">
                    {/* Top-level: compiled project document */}
                    {hasDocument && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProjectDoc(true);
                          setSelectedFileId(null);
                          setSelectedCodeFileId(null);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                          selectedProjectDoc
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        }`}
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="truncate">project_doc.md</span>
                      </button>
                    )}

                    {/* Document files by employee */}
                    {docFiles.length > 0 &&
                      (() => {
                        const byEmployee = docFiles.reduce<
                          Record<string, ProjectFile[]>
                        >((acc, f) => {
                          const key = f.employee.id;
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(f);
                          return acc;
                        }, {});
                        return Object.entries(byEmployee).map(
                          ([empId, files]) => {
                            const emp = files[0]?.employee;
                            if (!emp) return null;
                            const isExpanded = expandedEmployeeIds.has(empId);
                            return (
                              <div key={empId} className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleEmployeeFolder(empId)
                                  }
                                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-sm hover:bg-muted transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <FolderOpen className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                                  <span className="truncate font-medium">
                                    {emp.name} ({emp.role.title})
                                  </span>
                                </button>
                                {isExpanded && (
                                  <div className="ml-5 pl-2 border-l border-muted space-y-0.5">
                                    {(() => {
                                      const byPath = files.reduce<
                                        Record<string, ProjectFile[]>
                                      >((acc, f) => {
                                        const p = f.path ?? "";
                                        if (!acc[p]) acc[p] = [];
                                        acc[p].push(f);
                                        return acc;
                                      }, {});
                                      const paths = Object.keys(byPath).sort();
                                      return paths.map((pathKey) => (
                                        <div key={pathKey || "_root"} className="space-y-0.5">
                                          {pathKey && (
                                            <div className="px-2 py-1 text-xs font-medium text-muted-foreground truncate">
                                              {pathKey}/
                                            </div>
                                          )}
                                          {byPath[pathKey]
                                            .sort((a, b) =>
                                              a.title.localeCompare(b.title)
                                            )
                                            .map((file) => (
                                              <button
                                                key={file.id}
                                                type="button"
                                                id={file.id}
                                                onClick={() => {
                                                  setSelectedProjectDoc(false);
                                                  setSelectedFileId(file.id);
                                                  setSelectedCodeFileId(null);
                                                }}
                                                className={`w-full flex items-center gap-2 py-1 px-2 rounded text-left text-sm transition-colors ${
                                                  selectedFileId === file.id
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-muted"
                                                }`}
                                              >
                                                <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                                <span className="truncate">
                                                  {file.title.endsWith(".md")
                                                    ? file.title
                                                    : `${file.title}.md`}
                                                </span>
                                              </button>
                                            ))}
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                )}
                              </div>
                            );
                          }
                        );
                      })()}

                    {/* Code files by employee */}
                    {codeFiles.length > 0 &&
                      (() => {
                        const byEmployee = codeFiles.reduce<
                          Record<string, ProjectFile[]>
                        >((acc, f) => {
                          const key = f.employee.id;
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(f);
                          return acc;
                        }, {});
                        return Object.entries(byEmployee).map(
                          ([empId, files]) => {
                            const emp = files[0]?.employee;
                            if (!emp) return null;
                            const isExpanded =
                              expandedCodeEmployeeIds.has(empId);
                            return (
                              <div key={`code-${empId}`} className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleCodeEmployeeFolder(empId)
                                  }
                                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-sm hover:bg-muted transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <Code2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
                                  <span className="truncate font-medium">
                                    {emp.name} ({emp.role.title})
                                  </span>
                                </button>
                                {isExpanded && (
                                  <div className="ml-5 pl-2 border-l border-muted space-y-0.5">
                                    {(() => {
                                      const byPath = files.reduce<
                                        Record<string, ProjectFile[]>
                                      >((acc, f) => {
                                        const p = f.path ?? "";
                                        if (!acc[p]) acc[p] = [];
                                        acc[p].push(f);
                                        return acc;
                                      }, {});
                                      const paths = Object.keys(byPath).sort();
                                      return paths.map((pathKey) => (
                                        <div key={pathKey || "_root"} className="space-y-0.5">
                                          {pathKey && (
                                            <div className="px-2 py-1 text-xs font-medium text-muted-foreground truncate">
                                              {pathKey}/
                                            </div>
                                          )}
                                          {byPath[pathKey]
                                            .sort((a, b) =>
                                              a.title.localeCompare(b.title)
                                            )
                                            .map((file) => (
                                              <button
                                                key={file.id}
                                                type="button"
                                                id={file.id}
                                                onClick={() => {
                                                  setSelectedProjectDoc(false);
                                                  setSelectedFileId(null);
                                                  setSelectedCodeFileId(file.id);
                                                }}
                                                className={`w-full flex items-center gap-2 py-1 px-2 rounded text-left text-sm transition-colors ${
                                                  selectedCodeFileId === file.id
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-muted"
                                                }`}
                                              >
                                                <Code2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                                <span className="truncate">
                                                  {file.title}
                                                </span>
                                              </button>
                                            ))}
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                )}
                              </div>
                            );
                          }
                        );
                      })()}
                  </div>
                </div>
              </aside>

              {/* Resizer */}
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={handleResizeStart}
                className={`shrink-0 w-1 cursor-col-resize border-r bg-border hover:bg-primary/30 transition-colors flex items-center justify-center group ${
                  isResizing ? "bg-primary/50" : ""
                }`}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-active:opacity-100" />
              </div>

              {/* Right: workspace preview (project doc, doc file, or code file) */}
              <main className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
                {selectedProjectDoc && hasDocument ? (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <div className="p-6 max-w-3xl">
                      <h1 className="text-xl font-semibold mb-4">
                        {t("project.projectDoc")}
                      </h1>
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-6 prose-headings:mb-3 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-blockquote:my-3 prose-table:my-3 prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-a:text-primary prose-img:rounded-lg prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-muted/50 prose-hr:my-6 [&_pre]:my-3 [&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-base [&_pre]:font-mono [&_pre]:leading-snug [&_pre]:overflow-x-auto [&_pre]:overflow-y-visible [&_pre]:whitespace-pre [&_pre]:min-w-0 [&_pre]:text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {sanitizeDocumentContent(project.document!)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ) : selectedFileId ? (
                  (() => {
                    const file = docFiles.find(
                      (f) => f.id === selectedFileId
                    );
                    if (!file) return null;
                    return (
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        <div className="p-6 max-w-3xl">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm text-primary">
                              {file.employee.name[0]}
                            </span>
                            <div>
                              <h1 className="text-xl font-semibold">
                                {file.title}
                              </h1>
                              <p className="text-sm text-muted-foreground">
                                {file.employee.name} · {file.employee.role.title}
                              </p>
                            </div>
                          </div>
                          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-6 prose-headings:mb-3 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-blockquote:my-3 prose-table:my-3 prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-a:text-primary prose-img:rounded-lg prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-muted/50 prose-hr:my-6 [&_pre]:my-3 [&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-base [&_pre]:font-mono [&_pre]:leading-snug [&_pre]:overflow-x-auto [&_pre]:overflow-y-visible [&_pre]:whitespace-pre [&_pre]:min-w-0 [&_pre]:text-foreground">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {sanitizeDocumentContent(file.content)}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : selectedCodeFileId ? (
                  (() => {
                    const file = codeFiles.find(
                      (f) => f.id === selectedCodeFileId
                    );
                    if (!file) return null;
                    return (
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        <div className="p-6">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-sm text-emerald-600 dark:text-emerald-400">
                              {file.employee.name[0]}
                            </span>
                            <div>
                              <h1 className="text-xl font-semibold">
                                {file.title}
                              </h1>
                              <p className="text-sm text-muted-foreground">
                                {file.employee.name} · {file.employee.role.title}
                              </p>
                            </div>
                          </div>
                          <pre className="bg-muted rounded-lg p-4 text-sm overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-words">
                            <code>{file.content}</code>
                          </pre>
                        </div>
                      </div>
                    );
                  })()
                ) : !hasDocument && docFiles.length === 0 && codeFiles.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center px-6">
                    {allTasks.length > 0 ? (
                      <>
                        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                        <h3 className="text-lg font-medium">
                          {t("project.compiling")}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-2 max-w-md">
                          {t("project.compilingHint")}
                        </p>
                      </>
                    ) : (
                      <>
                        <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                        <h3 className="text-lg font-medium">
                          {t("project.projectStarting")}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-2 max-w-md">
                          {t("project.projectStartingHint")}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-muted-foreground px-6">
                    <FolderOpen className="h-12 w-12 opacity-50 mb-4" />
                    <p className="text-sm">{t("project.selectWorkspaceFile")}</p>
                  </div>
                )}
              </main>
            </div>
          </TabsContent>

          {/* Chat Tab */}
          <TabsContent
            value="chat"
            className="flex-1 flex flex-col m-0 overflow-hidden"
          >
            <div
              ref={chatScrollRef}
              className="flex-1 min-h-0 overflow-y-auto p-6"
            >
              <div className="space-y-4 max-w-3xl mx-auto">
                {/* Project brief */}
                {project.description && (
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <Info className="h-4 w-4" />
                      Project Brief
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {project.description}
                    </p>
                  </div>
                )}

                {(project.messages ?? []).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    <p>CEO 正在启动项目立项流程...</p>
                  </div>
                )}

                {/* Messages */}
                {(project.messages ?? []).map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    onViewFile={handleViewFile}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Message input */}
            <div className="border-t p-4">
              <div className="max-w-3xl mx-auto flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("project.messageCEO")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!message.trim() || sending}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Kanban Tab */}
          <TabsContent
            value="kanban"
            className="flex-1 m-0 overflow-auto p-6"
          >
            {allTasks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                <p>{t("project.waitingForTasks")}</p>
              </div>
            ) : (
              <div className="flex gap-4 min-h-full overflow-x-auto pb-4">
                {Object.entries(tasksByStatus).map(([status, tasks]) => (
                  <div
                    key={status}
                    className="flex-shrink-0 w-72"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {statusIcons[status]}
                      <h3 className="font-medium text-sm">
                        {t(`taskStatus.${status}`)}
                      </h3>
                      <Badge variant="secondary" className="text-xs ml-auto">
                        {tasks.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {tasks.map((task) => (
                        <KanbanCard key={task.id} task={task} />
                      ))}
                      {tasks.length === 0 && (
                        <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                          {t("project.noTasks")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="flex-1 m-0 overflow-auto p-6">
            <div className="space-y-3 h-full min-h-0">
              {timelineHasNew && (
                <div className="sticky top-0 z-10 flex justify-center">
                  <Button
                    size="sm"
                    onClick={applyNewTimelineEvents}
                    className="rounded-full shadow-sm"
                  >
                    {t("project.timelineNewEvents")} ({timelineNewCount}) · {t("project.timelineJumpLatest")}
                  </Button>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {t("project.timelineHorizontalHint")}
              </div>

              {timelineLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  <p>{t("project.timelineLoading")}</p>
                </div>
              ) : timelineError ? (
                <div className="text-center py-10 border rounded-lg bg-muted/20">
                  <p className="text-sm text-destructive mb-3">
                    {t("project.timelineLoadFailed")}: {timelineError}
                  </p>
                  <Button size="sm" variant="outline" onClick={fetchTimelineFirstPage}>
                    {t("project.timelineRetry")}
                  </Button>
                </div>
              ) : timelineItems.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>{t("project.timelineEmpty")}</p>
                </div>
              ) : (
                <div className="h-[calc(100vh-280px)] min-h-[420px] overflow-hidden border rounded-lg bg-slate-50/60 dark:bg-slate-950/40">
                  <div className="flex h-full min-h-0 overflow-y-auto">
                    <div
                      className="shrink-0 border-r border-amber-300/80 bg-amber-100/80 dark:border-amber-700/70 dark:bg-amber-900/35"
                      style={{ width: TIMELINE_LANE_WIDTH }}
                    >
                      {timelineLanes.map((lane) => (
                        <div
                          key={`lane-${lane.employeeId}`}
                          className="flex items-center border-b px-3 py-3"
                          style={{ minHeight: TIMELINE_ROW_MIN_HEIGHT }}
                        >
                          <div
                            className="shrink-0 flex flex-col items-center justify-center rounded-md border border-amber-400/80 dark:border-amber-700/80 bg-amber-100/95 dark:bg-amber-900/55 px-3 py-2 shadow-sm text-center"
                            style={{ width: TIMELINE_CARD_WIDTH, height: TIMELINE_CARD_HEIGHT }}
                          >
                            <div className="text-sm font-medium truncate w-full">{lane.name}</div>
                            <div className="text-xs text-muted-foreground truncate w-full">{lane.roleTitle}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div
                      ref={timelineViewportRef}
                      onScroll={handleTimelineScroll}
                      className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
                    >
                      <div className="relative min-w-max">
                        {timelineLanes.map((lane) => {
                          const events = timelineLaneEvents[lane.employeeId] ?? [];
                          return (
                            <div
                              key={`events-${lane.employeeId}`}
                              className="relative border-b"
                              style={{ minHeight: TIMELINE_ROW_MIN_HEIGHT }}
                            >
                              <div className="pointer-events-none absolute left-0 right-0 top-1/2 border-t border-dashed border-muted-foreground/30" />
                              <div
                                className="relative z-10 flex items-center gap-2 px-3 py-3"
                                style={{ minHeight: TIMELINE_ROW_MIN_HEIGHT }}
                              >
                                {events.length === 0 ? (
                                  <div
                                    className="shrink-0 rounded-md border border-dashed bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-center"
                                    style={{ width: TIMELINE_CARD_WIDTH, height: TIMELINE_CARD_HEIGHT }}
                                  >
                                    {t("project.timelineEmptyLane")}
                                  </div>
                                ) : (
                                  <TooltipProvider delayDuration={120}>
                                    <div className="flex items-center gap-2">
                                      {events.map((event, index) => {
                                        const eventTitle = formatTimelineEventTitle(event);
                                        const eventDetail = formatTimelineEventDetail(event);
                                        const eventTime = formatTimelineTimestamp(event.createdAt);
                                        const taskTitle = event.taskId ? taskTitleById.get(event.taskId) ?? null : null;
                                        return (
                                          <div key={getTimelineEventKey(event)} className="flex items-center gap-2">
                                            {index > 0 && <TimelineConnector />}
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Card
                                                  className="relative z-10 shrink-0 overflow-hidden border-blue-200/80 dark:border-blue-700/80 bg-blue-50/90 dark:bg-blue-950/40 shadow-sm"
                                                  style={{ width: TIMELINE_CARD_WIDTH, height: TIMELINE_CARD_HEIGHT }}
                                                >
                                                  <CardContent className="flex h-full min-w-0 flex-col items-center justify-center gap-2 overflow-hidden p-3 text-center">
                                                    <div
                                                      className="min-h-[1.25rem] min-w-0 shrink-0 w-full text-sm font-semibold leading-5 line-clamp-1 break-words"
                                                      title={eventTitle}
                                                    >
                                                      {eventTitle}
                                                    </div>
                                                    <div
                                                      className="min-h-[2.5rem] min-w-0 shrink-0 w-full text-xs leading-4 text-slate-700/90 dark:text-slate-300/90 line-clamp-2 break-words"
                                                      title={taskTitle ?? (event.taskId ? `任务: ${event.taskId}` : "项目级事件")}
                                                    >
                                                      {taskTitle ?? (event.taskId ? `任务: ${shortTaskId(event.taskId)}` : "项目级事件")}
                                                    </div>
                                                    <div className="min-h-[1rem] min-w-0 shrink-0 w-full text-xs font-medium text-muted-foreground truncate">
                                                      {eventTime}
                                                    </div>
                                                  </CardContent>
                                                </Card>
                                              </TooltipTrigger>
                                              <TooltipContent side="top" align="start" className="max-w-[460px] whitespace-pre-wrap">
                                                <div className="space-y-1 text-xs">
                                                  <div className="font-semibold">{eventTitle}</div>
                                                  <div className="text-muted-foreground">{eventDetail}</div>
                                                  <div>时间: {eventTime}</div>
                                                  {event.taskId ? <div>任务 ID: {event.taskId}</div> : null}
                                                  {taskTitle ? <div>任务名称: {taskTitle}</div> : null}
                                                  <div>执行者: {event.actor || "-"}</div>
                                                  {event.payload ? (
                                                    <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-[10px] leading-4">{event.payload}</pre>
                                                  ) : null}
                                                </div>
                                              </TooltipContent>
                                            </Tooltip>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </TooltipProvider>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="px-3 py-2 border-t text-xs text-muted-foreground flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {timelineLoadingOlder && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t("project.timelineLoadingOlder")}
                        </span>
                      )}
                      {!timelineOldestCursor && !timelineLoadingOlder && (
                        <span>{t("project.timelineNoOlder")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const viewport = timelineViewportRef.current;
                          if (!viewport) return;
                          viewport.scrollLeft = viewport.scrollWidth;
                        }}
                      >
                        {t("project.timelineJumpLatest")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="flex-1 m-0 overflow-auto p-6">
            <div className="max-w-3xl mx-auto grid gap-3 md:grid-cols-2">
              {projectTeamEmployees.map((emp) => {
                const assignedToEmp = (t: Task) =>
                  t.assignments?.some(
                    (a: { employee: { id: string } }) => a.employee.id === emp.id
                  );
                const currentTask =
                  allTasks.find(
                    (t) => assignedToEmp(t) && t.status === "in_progress"
                  ) ??
                  allTasks.find(
                    (t) => assignedToEmp(t) && t.status === "assigned"
                  );
                return (
                  <TooltipProvider key={emp.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Card className="cursor-default">
                          <CardContent className="flex flex-col gap-3 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                          {emp.name[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{emp.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {emp.role.title}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div
                            className={`h-2 w-2 rounded-full ${getEmployeeStatusColor(emp.status)}`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {t(`team.${emp.status}`)}
                          </span>
                        </div>
                      </div>
                      {currentTask && (
                        <div className="text-xs text-muted-foreground border-t pt-2">
                          <span className="font-medium text-foreground/80">
                            {t("project.currentTask")}:
                          </span>{" "}
                          <span className="truncate block" title={currentTask.title}>
                            {currentTask.title}
                          </span>
                        </div>
                      )}
                          </CardContent>
                        </Card>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        {currentTask
                          ? `${t("project.currentTask")}: ${currentTask.title}`
                          : t("project.noTasks")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onViewFile,
}: {
  message: Message;
  onViewFile?: (fileId: string) => void;
}) {
  const { t } = useTranslation();
  const isFounder = message.senderType === "founder";
  const isSystem = message.senderType === "system";
  let meta: { fileId?: string; brief?: string; fileType?: string } | undefined;
  try {
    meta = message.metadata
      ? (JSON.parse(message.metadata) as {
          fileId?: string;
          brief?: string;
          fileType?: string;
        })
      : undefined;
  } catch {
    meta = undefined;
  }
  const hasFileRef = !!meta?.fileId;
  const isCodeFile = meta?.fileType === "code";

  if (isSystem) {
    const TRUNCATE_LEN = 120;
    const isLong = message.content.length > TRUNCATE_LEN;
    const truncated = isLong
      ? message.content.slice(0, TRUNCATE_LEN).trim() + "…"
      : message.content;

    return (
      <div className="flex justify-center">
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-lg max-w-[80%] text-center">
          {isLong ? (
            <Dialog>
              <div className="text-left flex items-center gap-2 min-w-0">
                <span className="truncate">{truncated}</span>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t("project.viewMore")}
                  </button>
                </DialogTrigger>
              </div>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("project.systemMessage")}</DialogTitle>
                </DialogHeader>
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-pre:my-3 prose-code:bg-muted prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <p className="whitespace-pre-wrap text-left">{message.content}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-3 ${isFounder ? "flex-row-reverse" : "flex-row"}`}
      id={meta?.fileId ? `msg-${meta.fileId}` : undefined}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          isFounder
            ? "bg-sky-600 text-white"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        {isFounder ? (
          <User className="h-4 w-4" />
        ) : message.sender ? (
          message.sender.name[0]
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>
      <div className={`flex flex-col gap-1 max-w-[80%] ${isFounder ? "items-end" : "items-start"}`}>
        {(isFounder || message.sender) && (
          <div className="text-xs font-medium text-muted-foreground">
            {isFounder ? t("common.me") : `${message.sender!.name} · ${message.sender!.role.title}`}
          </div>
        )}
        <div
          className={`rounded-lg px-4 py-2.5 w-full ${
            isFounder ? "bg-sky-600 text-white" : "bg-muted"
          }`}
        >
        {hasFileRef ? (
          (() => {
            const fileId = meta?.fileId;
            return (
              <div className="text-sm">
                <p className={isFounder ? "text-white/90 line-clamp-2" : "text-muted-foreground line-clamp-2"}>
                  {meta?.brief ?? message.content}
                </p>
                {onViewFile && fileId && (
                  <button
                    type="button"
                    onClick={() => onViewFile(fileId)}
                    className={`mt-2 inline-flex items-center gap-1 text-xs hover:underline ${isFounder ? "text-white/90 hover:text-white" : "text-primary"}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {isCodeFile ? t("project.viewCode") : t("project.viewDoc")}
                  </button>
                )}
              </div>
            );
          })()
        ) : (() => {
          const LONG_MSG = 250;
          const isLongDoc = message.content.length > LONG_MSG;
          if (isLongDoc) {
            return (
              <div className="text-sm">
                <p className="text-muted-foreground line-clamp-2">
                  {message.content.slice(0, LONG_MSG).trim()}…
                </p>
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Expand className="h-3 w-3" />
                      {t("project.viewMore")}
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>
                        {message.sender?.name} · {message.sender?.role.title}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-pre:my-3 prose-code:bg-muted prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-4">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            );
          }
          return (
            <div
              className={`text-sm break-words prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-pre:rounded-md prose-pre:p-3 ${
                isFounder
                  ? "prose-invert prose-p:text-white prose-headings:text-white prose-li:text-white prose-strong:text-white prose-code:bg-white/20 prose-code:text-white prose-pre:bg-white/20 prose-pre:text-white prose-a:text-sky-100"
                  : "dark:prose-invert prose-code:bg-muted prose-pre:bg-muted prose-a:text-primary"
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          );
        })()}
        <div
          className={`text-xs mt-1 ${isFounder ? "text-white/80" : "text-muted-foreground"}`}
        >
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
        </div>
      </div>
    </div>
  );
}

function KanbanCard({ task }: { task: Task }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-medium text-sm leading-tight">
            {task.title}
          </span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            P{task.priority}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {task.description}
        </p>
        {task.assignments.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-medium">
              {task.assignments[0].employee.name[0]}
            </div>
            <span className="text-xs text-muted-foreground">
              {task.assignments[0].employee.name}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineConnector() {
  return (
    <svg
      width="28"
      height="20"
      viewBox="0 0 28 20"
      className="shrink-0 text-muted-foreground/80"
      aria-hidden="true"
    >
      <line x1="2" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M22 6.5L26 10L22 13.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TaskCard({ task }: { task: Task }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const normalizedStatus = normalizeTaskStatus(task.status);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {statusIcons[normalizedStatus]}
              <span className="font-medium text-sm">{task.title}</span>
              <Badge variant="outline" className="text-xs">
                P{task.priority}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {task.description}
            </p>
            {task.assignments.length > 0 && (
              <div className="flex items-center gap-1 mt-2">
                <span className="text-xs text-muted-foreground">
                  {t("project.assignedTo")}:
                </span>
                {task.assignments.map((a) => (
                  <Badge
                    key={a.employee.id}
                    variant="secondary"
                    className="text-xs"
                  >
                    {a.employee.name} ({a.employee.role.title})
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Badge
            variant={statusVariant[normalizedStatus] ?? "secondary"}
            className="text-xs shrink-0"
          >
            {t(`taskStatus.${normalizedStatus}`)}
          </Badge>
        </div>

        {task.output && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary hover:underline cursor-pointer"
            >
              {expanded ? t("project.hideOutput") : t("project.viewOutput")}
            </button>
            {expanded && (
              <div className="mt-2 text-sm bg-muted p-3 rounded-md overflow-auto max-h-80">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {task.output}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sub-tasks */}
        {task.subTasks && task.subTasks.length > 0 && (
          <div className="mt-3 ml-6 space-y-2 border-l-2 pl-4">
            {task.subTasks.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2 text-sm">
                {statusIcons[normalizeTaskStatus(sub.status)]}
                <span
                  className={
                    normalizeTaskStatus(sub.status) === "done"
                      ? "line-through text-muted-foreground"
                      : ""
                  }
                >
                  {sub.title}
                </span>
                {sub.assignments.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {sub.assignments[0].employee.name}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getTimelineEventKey(event: TimelineEvent): string {
  if (event.id) return event.id;
  return `${event.eventType}|${event.createdAt}|${event.summary}|${event.actor}|${event.taskId ?? ""}`;
}

function mergeTimelineEvents(...chunks: TimelineEvent[][]): TimelineEvent[] {
  const map = new Map<string, TimelineEvent>();
  for (const chunk of chunks) {
    for (const item of chunk) {
      map.set(getTimelineEventKey(item), item);
    }
  }
  return sortTimelineEventsAsc(Array.from(map.values()));
}

function sortTimelineEventsAsc(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return getTimelineEventKey(a).localeCompare(getTimelineEventKey(b));
  });
}

function buildProjectTimelineLanes(
  allEmployees: Employee[],
  projectTeamEmployees: Employee[],
  events: TimelineEvent[]
): TimelineLane[] {
  const baseline = new Map(projectTeamEmployees.map((emp) => [emp.id, emp]));
  const allByID = new Map(allEmployees.map((emp) => [emp.id, emp]));
  const lanesByEmployeeID = new Map<string, TimelineLane>();
  const eventOrder = [...events].reverse();

  for (const event of eventOrder) {
    const actor = event.actor.trim();
    const laneEmployee = resolveTimelineActorEmployee(actor, allEmployees);
    const eventAt = new Date(event.createdAt).getTime();
    if (laneEmployee) {
      lanesByEmployeeID.set(laneEmployee.id, {
        employeeId: laneEmployee.id,
        name: laneEmployee.name,
        roleTitle: laneEmployee.role.title,
        lastActiveAt: eventAt,
      });
    }
  }

  for (const [, employee] of baseline) {
    if (!lanesByEmployeeID.has(employee.id)) {
      lanesByEmployeeID.set(employee.id, {
        employeeId: employee.id,
        name: employee.name,
        roleTitle: employee.role.title,
        lastActiveAt: 0,
      });
    }
  }
  return Array.from(lanesByEmployeeID.values()).sort((a, b) => {
    const aEmp = allByID.get(a.employeeId);
    const bEmp = allByID.get(b.employeeId);
    const aIsCEO = aEmp?.role.name === "ceo" || a.roleTitle.toLowerCase().includes("ceo");
    const bIsCEO = bEmp?.role.name === "ceo" || b.roleTitle.toLowerCase().includes("ceo");
    if (aIsCEO && !bIsCEO) return -1;
    if (!aIsCEO && bIsCEO) return 1;
    if (a.lastActiveAt !== b.lastActiveAt) return b.lastActiveAt - a.lastActiveAt;
    return a.name.localeCompare(b.name);
  });
}

function buildTimelineLaneEvents(
  employees: Employee[],
  lanes: TimelineLane[],
  events: TimelineEvent[],
  taskAssigneeByID: Map<string, string>
): Record<string, TimelineEvent[]> {
  const laneEvents: Record<string, TimelineEvent[]> = {};
  const laneSet = new Set(lanes.map((lane) => lane.employeeId));

  for (const lane of lanes) {
    laneEvents[lane.employeeId] = [];
  }

  for (const event of events) {
    const employee = resolveTimelineActorEmployee(event.actor, employees);
    if (employee && laneSet.has(employee.id)) {
      laneEvents[employee.id].push(event);
      continue;
    }
    if (event.taskId) {
      const assigneeID = taskAssigneeByID.get(event.taskId);
      if (assigneeID && laneSet.has(assigneeID)) {
        laneEvents[assigneeID].push(event);
        continue;
      }
    }
  }

  for (const lane of lanes) {
    laneEvents[lane.employeeId].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  return laneEvents;
}

function resolveTimelineActorEmployee(actor: string, employees: Employee[]): Employee | null {
  if (!actor) return null;
  const normalized = actor.trim();
  const lower = normalized.toLowerCase();

  const byID = new Map(employees.map((e) => [e.id, e]));
  if (byID.has(normalized)) return byID.get(normalized) ?? null;

  const parts = normalized.split(":");
  const maybeID = parts.length >= 2 ? parts[parts.length - 1] : "";
  if (maybeID && byID.has(maybeID)) return byID.get(maybeID) ?? null;

  const nameOnly = normalized.includes("(")
    ? normalized.slice(0, normalized.indexOf("(")).trim()
    : normalized;
  const byName = employees.find((e) => e.name.toLowerCase() === nameOnly.toLowerCase());
  if (byName) return byName;

  if (lower === "ceo") {
    return employees.find((e) => e.role.name === "ceo" || e.role.title.toLowerCase().includes("ceo")) ?? null;
  }
  return null;
}

function buildTaskAssigneeMap(tasks: Task[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of tasks) {
    const assignee = task.assignments?.[0]?.employee?.id;
    if (assignee) map.set(task.id, assignee);
  }
  return map;
}

function buildTaskTitleMap(tasks: Task[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of tasks) {
    map.set(task.id, task.title);
  }
  return map;
}

function parseTimelineEventFromSSE(projectID: string, evt: MessageEvent<string>): TimelineEvent | null {
  if (!evt?.data) return null;
  try {
    const raw = JSON.parse(evt.data) as Record<string, unknown>;
    const id = typeof raw.id === "string" && raw.id ? raw.id : `sse-${Date.now()}`;
    const eventType = typeof raw.eventType === "string" && raw.eventType
      ? raw.eventType
      : typeof raw.type === "string"
        ? raw.type
        : "task.updated";
    const createdAtRaw = raw.createdAt;
    const createdAt = typeof createdAtRaw === "string"
      ? createdAtRaw
      : new Date().toISOString();
    const senderID = typeof raw.senderId === "string" ? raw.senderId : "";
    const senderType = typeof raw.senderType === "string" ? raw.senderType : "";
    const actor = senderID || senderType || "system";
    const summary = typeof raw.summary === "string"
      ? raw.summary
      : typeof raw.content === "string"
        ? raw.content
        : eventType;
    let payload: string | null = null;
    if (raw.metadata && typeof raw.metadata === "object") {
      payload = JSON.stringify(raw.metadata);
    }
    const taskId = typeof raw.taskId === "string" ? raw.taskId : null;
    return {
      id,
      projectId: projectID,
      taskId,
      eventType,
      actor,
      summary,
      payload,
      createdAt,
    };
  } catch {
    return null;
  }
}

function shortTaskId(taskId: string): string {
  if (taskId.length <= 10) return taskId;
  return `${taskId.slice(0, 6)}...${taskId.slice(-4)}`;
}

function formatTimelineEventTitle(event: TimelineEvent): string {
  const type = (event.eventType || "").trim();
  switch (type) {
    case "task.transition":
    case "task.transitioned":
      return "任务状态变更";
    case "project.transition":
      return "项目状态变更";
    case "project.updated":
      return "项目更新";
    case "task.updated":
      return "任务执行更新";
    case "engine.alert":
      return "引擎告警";
    default:
      if (type !== "") return type;
      return "时间线事件";
  }
}

function formatTimelineEventDetail(event: TimelineEvent): string {
  const payload = parseTimelinePayload(event.payload);
  const reason = readStringField(payload, "reason");
  const from = readStringField(payload, "from");
  const to = readStringField(payload, "to");

  if (event.eventType === "task.transition" || event.eventType === "task.transitioned") {
    const parts: string[] = [];
    if (from && to) parts.push(`状态 ${from} -> ${to}`);
    if (reason) parts.push(`原因: ${reason}`);
    if (parts.length > 0) return parts.join(" · ");
  }

  if (event.eventType === "project.transition" || event.eventType === "project.updated") {
    const parts: string[] = [];
    if (from && to) parts.push(`项目状态 ${from} -> ${to}`);
    if (reason) parts.push(`原因: ${reason}`);
    if (parts.length > 0) return parts.join(" · ");
  }

  if (event.eventType === "task.updated") {
    const toolCalls = readNumberField(payload, "toolCalls");
    const createdFiles = readNumberField(payload, "createdFiles");
    const enteredReview = readBoolField(payload, "enteredReview");
    const emptyRound = readBoolField(payload, "emptyRound");
    const parts: string[] = [];
    if (toolCalls !== null) parts.push(`工具调用 ${toolCalls}`);
    if (createdFiles !== null) parts.push(`新文件 ${createdFiles}`);
    if (enteredReview !== null) parts.push(enteredReview ? "已提交审核" : "继续执行");
    if (emptyRound === true) parts.push("本轮无有效产出");
    if (reason) parts.push(`原因: ${reason}`);
    if (parts.length > 0) return parts.join(" · ");
  }

  const summary = (event.summary || "").trim();
  if (summary !== "" && !looksLikeTimestamp(summary)) {
    return summary;
  }

  if (reason) return `原因: ${reason}`;
  if (payload) {
    const compact = summarizePayload(payload);
    if (compact !== "") return compact;
  }
  const actor = (event.actor || "").trim();
  if (actor !== "") return `执行者: ${actor}`;
  return "暂无详细说明";
}

function parseTimelinePayload(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function readStringField(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload) return null;
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readNumberField(payload: Record<string, unknown> | null, key: string): number | null {
  if (!payload) return null;
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function readBoolField(payload: Record<string, unknown> | null, key: string): boolean | null {
  if (!payload) return null;
  const value = payload[key];
  if (typeof value === "boolean") return value;
  return null;
}

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).slice(0, 3);
  const parts: string[] = [];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") {
      parts.push(`${key}: ${value}`);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}: ${String(value)}`);
      continue;
    }
  }
  return parts.join(" · ");
}

function looksLikeTimestamp(value: string): boolean {
  const s = value.trim();
  if (s === "") return false;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return true;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) && /\d{4}/.test(s);
}

function formatTimelineTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeTaskStatus(status: string): string {
  switch (status) {
    case "created":
    case "ready":
    case "pending":
    case "assigned":
      return "todo";
    case "completed":
      return "done";
    case "cancelled":
      return "canceled";
    default:
      return status;
  }
}

function flattenTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  for (const task of tasks) {
    result.push(task);
    if (task.subTasks) {
      result.push(...flattenTasks(task.subTasks));
    }
  }
  return result;
}
