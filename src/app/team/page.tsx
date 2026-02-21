"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, User, MessageCircle, Sparkles, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "next/navigation";
import { getEmployeeStatusColor } from "@/lib/constants";
import { useTranslation } from "@/lib/i18n";

interface Role {
  id: string;
  name: string;
  title: string;
  systemPrompt?: string;
  isBuiltin: boolean;
  skills?: { skill: { id: string; name: string } }[];
}

interface Employee {
  id: string;
  name: string;
  status: string;
  role: Role;
}

export default function TeamPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [detailSkills, setDetailSkills] = useState<{ id: string; name: string }[]>([]);
  const [detailSkillsLoading, setDetailSkillsLoading] = useState(false);

  const fetchTeam = async () => {
    try {
      const res = await fetch("/api/team");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await fetch("/api/roles");
      if (res.ok) {
        const data = await res.json();
        setRoles(data);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchTeam();
    fetchRoles();
  }, []);

  useEffect(() => {
    if (!detailEmployee) {
      setDetailSkills([]);
      return;
    }
    setDetailSkillsLoading(true);
    fetch(`/api/team/${detailEmployee.id}/skills`)
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((data) => setDetailSkills(data.skills ?? []))
      .finally(() => setDetailSkillsLoading(false));
  }, [detailEmployee?.id]);

  const handleHire = async () => {
    if (!newName.trim() || !selectedRoleId) return;
    setHiring(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: selectedRoleId, name: newName }),
      });
      if (res.ok) {
        setNewName("");
        setSelectedRoleId("");
        setDialogOpen(false);
        fetchTeam();
      }
    } finally {
      setHiring(false);
    }
  };

  const { t } = useTranslation();

  return (
    <div>
      <Header
        title={t("team.title")}
        description={t("team.description")}
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                {t("team.hireAgent")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Hire New Agent</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium">Agent Name</label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="E.g. Sam"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Role</label>
                  <Select
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.title}
                          {role.isBuiltin ? "" : " (Custom)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleHire}
                  disabled={!newName.trim() || !selectedRoleId || hiring}
                  className="w-full"
                >
                  {hiring ? "Hiring..." : "Hire Agent"}
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
        ) : employees.length === 0 ? (
          <div className="text-center py-12">
            <User className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">{t("team.noMembers")}</h3>
            <p className="text-muted-foreground mt-1">
              {t("team.setUpFirst")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {employees.map((emp) => (
              <Card
                key={emp.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => setDetailEmployee(emp)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg">
                        {emp.name[0]}
                      </div>
                      <div
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${getEmployeeStatusColor(emp.status)}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{emp.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {emp.role.title}
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-xs text-muted-foreground">
                          {t(`team.${emp.status}`)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {emp.role.isBuiltin && (
                        <Badge variant="secondary" className="text-xs">
                          {t("team.builtin")}
                        </Badge>
                      )}
                      <div className="flex items-center gap-1">
                        <EmployeeSkillsDialog employeeId={emp.id} employeeName={emp.name} t={t} />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/team/${emp.id}`);
                          }}
                          title={`和 ${emp.name} 对话`}
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Employee detail dialog */}
      <Dialog open={!!detailEmployee} onOpenChange={(open) => !open && setDetailEmployee(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {detailEmployee && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                    {detailEmployee.name[0]}
                  </div>
                  {detailEmployee.name}
                </DialogTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{detailEmployee.role.title}</span>
                  <span>·</span>
                  <span>{t(`team.${detailEmployee.status}`)}</span>
                  {detailEmployee.role.isBuiltin && (
                    <Badge variant="secondary" className="text-xs">
                      {t("team.builtin")}
                    </Badge>
                  )}
                </div>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {detailEmployee.role.systemPrompt && (
                  <div>
                    <label className="text-sm font-medium">{t("team.systemPrompt")}</label>
                    <pre className="mt-1.5 max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-sans">
                      {detailEmployee.role.systemPrompt}
                    </pre>
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("team.skillsLabel")}
                  </label>
                  {detailSkillsLoading ? (
                    <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("common.loading")}
                    </p>
                  ) : (() => {
                    const roleSkills = detailEmployee.role.skills?.map((s) => s.skill) ?? [];
                    const employeeSkillIds = new Set(detailSkills.map((s) => s.id));
                    const roleOnly = roleSkills.filter((s) => !employeeSkillIds.has(s.id));
                    const merged = [...detailSkills, ...roleOnly];
                    if (merged.length === 0) {
                      return (
                        <p className="mt-1.5 text-xs text-muted-foreground">{t("skills.noSkills")}</p>
                      );
                    }
                    return (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {merged.map((s) => (
                          <Badge key={s.id} variant="outline" className="text-xs font-normal">
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDetailEmployee(null)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    onClick={() => {
                      if (detailEmployee) router.push(`/team/${detailEmployee.id}`);
                    }}
                  >
                    <MessageCircle className="h-4 w-4 mr-1" />
                    {t("team.goToChat")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SkillItem {
  id: string;
  name: string;
  description: string | null;
  source: string;
}

function EmployeeSkillsDialog({
  employeeId,
  employeeName,
  t,
}: {
  employeeId: string;
  employeeName: string;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [allSkills, setAllSkills] = useState<SkillItem[]>([]);
  const [currentIds, setCurrentIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      fetch("/api/skills").then((r) => r.ok ? r.json() : []),
      fetch(`/api/team/${employeeId}/skills`).then((r) => r.ok ? r.json() : { skills: [] }),
    ])
      .then(([skills, { skills: empSkills }]) => {
        setAllSkills(skills);
        const ids = new Set((empSkills as { id: string }[]).map((s) => s.id));
        setCurrentIds(ids);
        setSelectedIds(ids);
      })
      .finally(() => setLoading(false));
  }, [open, employeeId]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/team/${employeeId}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillIds: Array.from(selectedIds) }),
      });
      if (res.ok) setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={(e) => e.stopPropagation()}
          title={t("skills.configureForEmployee")}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("skills.configureForEmployee")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{employeeName}</p>
        </DialogHeader>
        <div className="py-4">
          {loading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : allSkills.length === 0 ? (
            <p className="text-muted-foreground">{t("skills.noSkills")}</p>
          ) : (
            <div className="max-h-64 overflow-auto space-y-2">
              {allSkills.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 cursor-pointer rounded p-2 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.has(s.id)}
                    onCheckedChange={() => toggle(s.id)}
                  />
                  <span className="font-medium">{s.name}</span>
                  {s.description && (
                    <span className="text-xs text-muted-foreground truncate">
                      {s.description}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={loading || saving}>
              {saving ? t("skills.saving") : t("skills.saveSkills")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
