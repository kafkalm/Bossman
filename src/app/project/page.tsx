"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FolderKanban, Plus, Trash2 } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  _count: { tasks: number; messages: number };
}

const DESC_MAX = 200;

export default function ProjectListPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = () => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then(setProjects)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleDeleteProject = async (
    e: React.MouseEvent,
    projectId: string
  ) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          description: projectDesc || undefined,
        }),
      });
      if (res.ok) {
        const project = await res.json();
        router.push(`/project/${project.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const statusVariant: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    planning: "secondary",
    in_progress: "default",
    review: "outline",
    completed: "default",
    failed: "destructive",
  };

  const statusLabel: Record<string, string> = {
    planning: "Planning",
    in_progress: "In Progress",
    review: "Review",
    completed: "Completed",
    failed: "Failed",
  };

  return (
    <div>
      <Header
        title="Projects"
        description="All projects in your company"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  输入项目名称即可创建，CEO 将自动发起立项并协调团队完成项目文档。
                </p>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium">Project Name</label>
                  <Input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="E.g. E-commerce Platform"
                    className="mt-1"
                    autoFocus
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">
                      Brief Description{" "}
                      <span className="text-muted-foreground font-normal">
                        (Optional)
                      </span>
                    </label>
                    <span
                      className={`text-xs ${
                        projectDesc.length > DESC_MAX
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {projectDesc.length}/{DESC_MAX}
                    </span>
                  </div>
                  <Textarea
                    value={projectDesc}
                    onChange={(e) => {
                      if (e.target.value.length <= DESC_MAX) {
                        setProjectDesc(e.target.value);
                      }
                    }}
                    placeholder="简要描述项目方向或想法，CEO 会据此展开详细规划..."
                    className="mt-1 resize-none"
                    rows={3}
                  />
                </div>
                <Button
                  onClick={handleCreateProject}
                  disabled={!projectName.trim() || creating}
                  className="w-full"
                >
                  {creating ? "Creating..." : "Create Project"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading...
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <FolderKanban className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">No projects yet</h3>
            <p className="text-muted-foreground mt-1">
              Click &quot;New Project&quot; to create your first project.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/project/${project.id}`)}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{project.name}</span>
                    {project.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {project._count.tasks} tasks
                    </span>
                    <Badge
                      variant={statusVariant[project.status] ?? "secondary"}
                    >
                      {statusLabel[project.status] ?? project.status}
                    </Badge>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            确认删除项目
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            将永久删除项目 <strong>&quot;{project.name}&quot;</strong> 及其所有关联数据（任务、消息、文档、Token 使用记录）。此操作不可撤销。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(e) => handleDeleteProject(e, project.id)}
                          >
                            删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
