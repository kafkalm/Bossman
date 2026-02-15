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
import { Plus, User, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { getEmployeeStatusColor } from "@/lib/constants";
import { useTranslation } from "@/lib/i18n";

interface Role {
  id: string;
  name: string;
  title: string;
  isBuiltin: boolean;
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
                onClick={() => router.push(`/team/${emp.id}`)}
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
