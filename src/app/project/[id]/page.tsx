"use client";

import { useEffect, useState, useRef, use, useCallback } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Send,
  User,
  Bot,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Info,
  FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  createdAt: string;
  taskId: string | null;
  sender: {
    id: string;
    name: string;
    role: { title: string };
  } | null;
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
}

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3.5 w-3.5 text-gray-400" />,
  assigned: <Clock className="h-3.5 w-3.5 text-yellow-500" />,
  in_progress: <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
  review: <AlertCircle className="h-3.5 w-3.5 text-purple-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  blocked: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
  blocked: "Blocked",
  planning: "Planning",
  failed: "Failed",
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

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
    // Poll for updates every 3 seconds
    pollIntervalRef.current = setInterval(fetchProject, 3000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [fetchProject]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [project?.messages?.length]);

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

  const allTasks = flattenTasks(project.tasks);
  const completedTasks = allTasks.filter((t) => t.status === "completed");
  const progressPercent =
    allTasks.length > 0
      ? Math.round((completedTasks.length / allTasks.length) * 100)
      : 0;

  // Group tasks by status for kanban
  const tasksByStatus: Record<string, Task[]> = {
    pending: [],
    assigned: [],
    in_progress: [],
    completed: [],
    blocked: [],
  };
  for (const task of allTasks) {
    const group = tasksByStatus[task.status] ?? tasksByStatus.pending;
    group.push(task);
  }

  const hasDocument = !!project.document;

  return (
    <div className="flex flex-col h-screen">
      <Header
        title={project.name}
        description={project.description || undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant[project.status] ?? "secondary"}>
              {statusLabels[project.status] ?? project.status}
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

      {/* Progress bar */}
      {allTasks.length > 0 && (
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
            <span>
              Progress: {completedTasks.length} / {allTasks.length} tasks
            </span>
            <span>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue={hasDocument ? "document" : "chat"} className="flex flex-col h-full">
          <div className="border-b px-6">
            <TabsList className="h-10">
              <TabsTrigger value="document" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Document
                {!hasDocument && allTasks.length > 0 && (
                  <Loader2 className="h-3 w-3 animate-spin ml-1" />
                )}
              </TabsTrigger>
              <TabsTrigger value="chat">
                Chat ({project.messages.length})
              </TabsTrigger>
              <TabsTrigger value="kanban">
                Kanban ({allTasks.length})
              </TabsTrigger>
              <TabsTrigger value="tasks">
                Task List
              </TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
            </TabsList>
          </div>

          {/* Document Tab */}
          <TabsContent
            value="document"
            className="flex-1 m-0 overflow-auto"
          >
            {hasDocument ? (
              <div className="max-w-4xl mx-auto p-6">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-6 prose-headings:mb-3 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-3 prose-blockquote:my-3 prose-table:my-3 prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-4 prose-a:text-primary prose-img:rounded-lg prose-table:text-sm prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-muted/50 prose-hr:my-6">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {project.document!}
                  </ReactMarkdown>
                </div>
              </div>
            ) : allTasks.length > 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <h3 className="text-lg font-medium">正在编制项目文档...</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-md">
                  CEO 正在协调团队成员完成各自的文档部分，完成后将自动汇编成完整的项目文档。
                  你可以在 Chat 标签页查看实时进展。
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium">项目正在启动中...</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-md">
                  CEO 正在分析项目需求，稍后将协调团队开始编制项目文档。
                </p>
              </div>
            )}
          </TabsContent>

          {/* Chat Tab */}
          <TabsContent
            value="chat"
            className="flex-1 flex flex-col m-0 overflow-hidden"
          >
            <ScrollArea className="flex-1 h-0 p-6">
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

                {project.messages.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    <p>CEO 正在启动项目立项流程...</p>
                  </div>
                )}

                {/* Messages */}
                {project.messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message input */}
            <div className="border-t p-4">
              <div className="max-w-3xl mx-auto flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Message the CEO..."
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
                <p>等待 CEO 分配任务...</p>
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
                        {statusLabels[status] ?? status}
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
                          No tasks
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
              {project.tasks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  <p>等待 CEO 分配任务...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {project.tasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="flex-1 m-0 overflow-auto p-6">
            <div className="max-w-3xl mx-auto grid gap-3 md:grid-cols-2">
              {project.company.employees.map((emp) => (
                <Card key={emp.id}>
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                      {emp.name[0]}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{emp.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {emp.role.title}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          emp.status === "busy"
                            ? "bg-green-500"
                            : emp.status === "offline"
                              ? "bg-red-400"
                              : "bg-gray-400"
                        }`}
                      />
                      <span className="text-xs text-muted-foreground capitalize">
                        {emp.status}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isFounder = message.senderType === "founder";
  const isSystem = message.senderType === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full max-w-[80%] text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-3 ${isFounder ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          isFounder
            ? "bg-primary text-primary-foreground"
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
      <div
        className={`rounded-lg px-4 py-2.5 max-w-[80%] ${
          isFounder ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {!isFounder && message.sender && (
          <div
            className={`text-xs font-medium mb-1 ${isFounder ? "opacity-70" : "text-primary"}`}
          >
            {message.sender.name} &middot; {message.sender.role.title}
          </div>
        )}
        <div className="text-sm break-words prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-pre:bg-background/50 prose-pre:rounded-md prose-pre:p-3 prose-a:text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
        <div
          className={`text-xs mt-1 ${isFounder ? "opacity-50" : "text-muted-foreground"}`}
        >
          {new Date(message.createdAt).toLocaleTimeString()}
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
                  Assigned to:
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
            {statusLabels[task.status] ?? task.status}
          </Badge>
        </div>

        {task.output && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary hover:underline cursor-pointer"
            >
              {expanded ? "Hide Output" : "View Output"}
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
