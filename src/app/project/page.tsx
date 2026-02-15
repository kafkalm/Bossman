"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
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
import Link from "next/link";
import { getProjectStatusColor } from "@/lib/constants";
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
import { FolderKanban, Plus, Trash2, Coins } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  _count: { tasks: number; messages: number };
  tokenCount?: number;
}

const DESC_MAX = 200;

export default function ProjectListPage() {
  const router = useRouter();
  const { t } = useTranslation();
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
        setDialogOpen(false);
        window.location.href = `/project/${project.id}`;
      }
    } finally {
      setCreating(false);
    }
  };

  const statusLabelKeys: Record<string, string> = {
    planning: "taskStatus.planning",
    in_progress: "taskStatus.in_progress",
    review: "taskStatus.review",
    completed: "taskStatus.completed",
    failed: "taskStatus.failed",
  };

  return (
    <div>
      <Header
        title={t("project.title")}
        description={t("project.listDescription")}
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                {t("project.newProject")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("dashboard.createProjectTitle")}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("dashboard.createProjectHint")}
                </p>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium">{t("dashboard.projectNameLabel")}</label>
                  <Input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder={t("dashboard.projectNamePlaceholder")}
                    className="mt-1"
                    autoFocus
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">
                      {t("dashboard.briefDescOptional")}
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
                    placeholder={t("dashboard.briefDescPlaceholder")}
                    className="mt-1 resize-none"
                    rows={3}
                  />
                </div>
                <Button
                  onClick={handleCreateProject}
                  disabled={!projectName.trim() || creating}
                  className="w-full"
                >
                  {creating ? t("dashboard.creatingProject") : t("dashboard.createProjectButton")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <FolderKanban className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">{t("project.noProjects")}</h3>
            <p className="text-muted-foreground mt-1">
              {t("project.createFirst")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="hover:border-primary/50 transition-colors"
              >
                <CardContent className="flex items-center justify-between py-4">
                  <Link
                    href={`/project/${project.id}`}
                    className="flex-1 min-w-0 block hover:opacity-80"
                  >
                    <span className="font-medium">{project.name}</span>
                    {project.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {project.description}
                      </p>
                    )}
                  </Link>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span className="text-sm text-muted-foreground whitespace-nowrap flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5" />
                      {(project.tokenCount ?? 0).toLocaleString()} {t("project.tokens")}
                    </span>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {project._count.tasks} tasks
                    </span>
                    <Badge
                      variant="outline"
                      className={getProjectStatusColor(project.status)}
                    >
                      {statusLabelKeys[project.status]
                        ? t(statusLabelKeys[project.status])
                        : project.status}
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
                            {t("project.deleteTitle")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("project.deleteDescriptionBefore")}
                            <strong>&quot;{project.name}&quot;</strong>
                            {t("project.deleteDescriptionAfter")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(e) => handleDeleteProject(e, project.id)}
                          >
                            {t("common.delete")}
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
