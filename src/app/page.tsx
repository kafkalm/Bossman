"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Building2,
  FolderKanban,
  Users,
  Coins,
  Plus,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { getEmployeeStatusColor, getProjectStatusColor } from "@/lib/constants";
import { useTranslation } from "@/lib/i18n";

interface Employee {
  id: string;
  name: string;
  status: string;
  role: { id: string; name: string; title: string };
}

interface Project {
  id: string;
  name: string;
  status: string;
  description: string;
}

interface Company {
  id: string;
  name: string;
  description: string | null;
  employees: Employee[];
  projects: Project[];
}

const DESC_MAX = 200;

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupName, setSetupName] = useState("");
  const [setupDesc, setSetupDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // New project dialog
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const fetchCompany = async () => {
    try {
      const res = await fetch("/api/companies");
      if (res.ok) {
        const data = await res.json();
        setCompany(data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompany();
  }, []);

  const handleSetup = async () => {
    if (!setupName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: setupName,
          description: setupDesc || undefined,
        }),
      });
      if (res.ok) {
        await fetchCompany();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    setCreatingProject(true);
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
        setProjectDialogOpen(false);
        window.location.href = `/project/${project.id}`;
      }
    } finally {
      setCreatingProject(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Header title="Dashboard" />
        <div className="p-6 text-center text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Onboarding: no company yet
  if (!company) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Rocket className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Welcome to Bossman</CardTitle>
            <p className="text-muted-foreground mt-2">
              Give your AI company a name to get started. A default team of AI
              agents will be automatically set up for you.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Company Name</label>
              <Input
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                placeholder="E.g. Acme AI Labs"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                value={setupDesc}
                onChange={(e) => setSetupDesc(e.target.value)}
                placeholder="What does your AI company do?"
                className="mt-1"
                rows={3}
              />
            </div>
            <Button
              onClick={handleSetup}
              disabled={!setupName.trim() || creating}
              className="w-full"
              size="lg"
            >
              {creating ? "Setting up..." : "Create My Company"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Header
        title={company.name}
        description={company.description ?? t("dashboard.description")}
        actions={
          <Dialog
            open={projectDialogOpen}
            onOpenChange={setProjectDialogOpen}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                {t("dashboard.newProject")}
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
                  disabled={!projectName.trim() || creatingProject}
                  className="w-full"
                >
                  {creatingProject ? t("dashboard.creatingProject") : t("dashboard.createProjectButton")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("dashboard.company")}
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{company.name}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("dashboard.projectsCard")}
              </CardTitle>
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {company.projects.length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("dashboard.teamMembers")}
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {company.employees.length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("dashboard.tokenUsage")}
              </CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                {t("dashboard.analyticsDetail")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Team Overview */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("team.title")} ({company.employees.length})
            </CardTitle>
            <Link href="/team">
              <Button variant="outline" size="sm">
                {t("dashboard.manageTeam")}
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {company.employees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 p-3 rounded-lg border"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium text-sm">
                    {emp.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{emp.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {emp.role.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-2 w-2 rounded-full ${getEmployeeStatusColor(emp.status)}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {t(`team.${emp.status}`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Projects */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5" />
              {t("dashboard.recentProjects")}
            </CardTitle>
            <Link href="/project">
              <Button variant="outline" size="sm">
                {t("common.viewAll")}
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {company.projects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t("dashboard.noProjects")}</p>
                <p className="text-sm mt-1">
                  {t("dashboard.createFirst")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {company.projects.slice(0, 5).map((project) => (
                  <Link
                    key={project.id}
                    href={`/project/${project.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent transition-colors"
                  >
                    <div>
                      <span className="font-medium">{project.name}</span>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {project.description}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={project.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={getProjectStatusColor(status)}>
      {t(`taskStatus.${status}`)}
    </Badge>
  );
}
