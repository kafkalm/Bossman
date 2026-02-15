"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, Hash, DollarSign, BarChart3 } from "lucide-react";

interface TokenAnalytics {
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    calls: number;
  };
  byEmployee: {
    name: string;
    role: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    calls: number;
  }[];
  recent: {
    id: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cost: number | null;
    createdAt: string;
    employee: { name: string; role: { title: string } };
    project: { name: string } | null;
  }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<TokenAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/tokens")
      .then((res) => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const total = data?.total ?? {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    calls: 0,
  };

  return (
    <div>
      <Header
        title="Analytics"
        description="Token usage and cost tracking"
      />

      <div className="p-6 space-y-6">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading analytics...
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Tokens
                  </CardTitle>
                  <Coins className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {total.totalTokens.toLocaleString()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {total.inputTokens.toLocaleString()} in /{" "}
                    {total.outputTokens.toLocaleString()} out
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Input Tokens
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {total.inputTokens.toLocaleString()}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    LLM Calls
                  </CardTitle>
                  <Hash className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{total.calls}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Estimated Cost
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    ${total.cost.toFixed(4)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* By Employee */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Usage by Agent
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!data?.byEmployee?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No token usage data yet. Start a project to see analytics.
                  </div>
                ) : (
                  <>
                    {/* Visual bars */}
                    <div className="space-y-3 mb-6">
                      {data.byEmployee.map((emp, i) => {
                        const maxTokens = Math.max(
                          ...data.byEmployee.map(
                            (e) => e.inputTokens + e.outputTokens
                          )
                        );
                        const totalTokens = emp.inputTokens + emp.outputTokens;
                        const percent =
                          maxTokens > 0
                            ? (totalTokens / maxTokens) * 100
                            : 0;

                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{emp.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {emp.role}
                                </Badge>
                              </div>
                              <span className="text-muted-foreground">
                                {totalTokens.toLocaleString()} tokens
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-2 font-medium">
                              Agent
                            </th>
                            <th className="text-left py-3 px-2 font-medium">
                              Role
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Input
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Output
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Calls
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.byEmployee.map((emp, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-3 px-2 font-medium">
                                {emp.name}
                              </td>
                              <td className="py-3 px-2 text-muted-foreground">
                                {emp.role}
                              </td>
                              <td className="py-3 px-2 text-right">
                                {emp.inputTokens.toLocaleString()}
                              </td>
                              <td className="py-3 px-2 text-right">
                                {emp.outputTokens.toLocaleString()}
                              </td>
                              <td className="py-3 px-2 text-right">
                                {emp.calls}
                              </td>
                              <td className="py-3 px-2 text-right">
                                ${emp.cost.toFixed(4)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            {data?.recent && data.recent.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent LLM Calls</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data.recent.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-3 rounded-lg border text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                            {r.employee.name[0]}
                          </div>
                          <div>
                            <div className="font-medium">
                              {r.employee.name}{" "}
                              <span className="text-muted-foreground font-normal">
                                ({r.employee.role.title})
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.model} &middot; {r.provider}
                              {r.project && ` &middot; ${r.project.name}`}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div>
                            {(
                              r.inputTokens + r.outputTokens
                            ).toLocaleString()}{" "}
                            tokens
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
