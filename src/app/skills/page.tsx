"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ExternalLink, FileText, Sparkles, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const AGENT_SKILLS_REPO_URL = "https://agentskillsrepo.com";

interface Skill {
  id: string;
  name: string;
  description: string | null;
  content: string;
  source: string;
}

export default function SkillsPage() {
  const { t } = useTranslation();
  const [command, setCommand] = useState("npx skills add ");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);

  const fetchSkills = () => {
    setSkillsLoading(true);
    fetch("/api/skills?source=all")
      .then((res) => (res.ok ? res.json() : []))
      .then(setSkills)
      .finally(() => setSkillsLoading(false));
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  const handleRun = async () => {
    const trimmed = command.trim();
    if (!trimmed.toLowerCase().startsWith("npx skills add ")) {
      setMessage({ type: "err", text: t("skills.installInvalid") });
      return;
    }
    if (trimmed.length <= "npx skills add ".length) {
      setMessage({ type: "err", text: t("skills.installMissingPkg") });
      return;
    }
    setMessage(null);
    setRunning(true);
    try {
      const res = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ type: "ok", text: t("skills.installSuccess") });
        setCommand("npx skills add ");
        fetchSkills();
      } else {
        setMessage({
          type: "err",
          text: data.error || data.stderr || String(data.message || res.statusText),
        });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <Header title={t("skills.title")} description={t("skills.description")} />

      <div className="p-6 max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5 text-primary" />
              {t("skills.goToRepoSearch")}
            </CardTitle>
            <CardDescription>{t("skills.goToRepoSearchHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href={AGENT_SKILLS_REPO_URL} target="_blank" rel="noopener noreferrer">
                {t("skills.goToRepoSearch")}
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              {t("skills.runNpxSkills")}
            </CardTitle>
            <CardDescription>{t("skills.runNpxSkillsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx skills add owner/repo"
              onKeyDown={(e) => e.key === "Enter" && handleRun()}
            />
            <Button onClick={handleRun} disabled={running}>
              {running ? t("skills.installRunning") : t("common.confirm")}
            </Button>
            {message && (
              <p
                className={`text-sm ${message.type === "ok" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
              >
                {message.text}
              </p>
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold mb-4">{t("skills.installedSkills")}</h2>
          {skillsLoading ? (
            <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
          ) : skills.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("skills.noInstalledSkills")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  t,
}: {
  skill: Skill;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {skill.name}
          </CardTitle>
        </div>
        {skill.description && (
          <CardDescription className="line-clamp-2">{skill.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
              <FileText className="h-4 w-4" />
              {t("skills.viewContent")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{skill.name}</DialogTitle>
              {skill.description && (
                <CardDescription>{skill.description}</CardDescription>
              )}
            </DialogHeader>
            <div className="flex-1 overflow-auto rounded bg-muted p-4 text-sm font-sans">
              <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-blockquote:my-2 prose-code:before:content-none prose-code:after:content-none prose-code:bg-muted/80 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs [&_pre]:my-2 [&_pre]:bg-muted/80 [&_pre]:rounded [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {skill.content}
                </ReactMarkdown>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
