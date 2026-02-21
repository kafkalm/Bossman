"use client";

import { useEffect, useLayoutEffect, useState, useRef, use, useCallback } from "react";
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
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    fetchProject();
    // SSE for real-time file/doc updates
    const es = new EventSource(`/api/projects/${id}/events`);
    es.addEventListener("refresh", () => fetchProject());
    // Poll fallback every 5s
    pollIntervalRef.current = setInterval(fetchProject, 5000);
    return () => {
      es.close();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
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

  const completedTasks = allTasks.filter((t) => t.status === "completed");
  const progressPercent =
    allTasks.length > 0
      ? Math.round((completedTasks.length / allTasks.length) * 100)
      : 0;

  // Group tasks by status for kanban (must match DB: pending, assigned, in_progress, review, completed, blocked)
  const kanbanStatusOrder = [
    "pending",
    "assigned",
    "in_progress",
    "review",
    "completed",
    "blocked",
  ] as const;
  const tasksByStatus: Record<string, Task[]> = Object.fromEntries(
    kanbanStatusOrder.map((s) => [s, []])
  ) as Record<string, Task[]>;
  for (const task of allTasks) {
    const group =
      tasksByStatus[task.status] ?? tasksByStatus.pending;
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
              <TabsTrigger value="tasks">
                {t("project.taskList")}
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

          {/* Tasks List Tab */}
          <TabsContent value="tasks" className="flex-1 m-0 overflow-auto p-6">
            <div className="max-w-4xl mx-auto">
              {(project.tasks ?? []).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  <p>{t("project.waitingForTasks")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(project.tasks ?? []).map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
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

function TaskCard({ task }: { task: Task }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {statusIcons[task.status]}
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
            variant={statusVariant[task.status] ?? "secondary"}
            className="text-xs shrink-0"
          >
            {t(`taskStatus.${task.status}`)}
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
                {statusIcons[sub.status]}
                <span
                  className={
                    sub.status === "completed"
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
