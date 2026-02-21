/**
 * Agent 工作区：文件存储在 .bossman_workspace/{projectId}/{employeeId}/ 下，不落 DB。
 * 同一项目下按员工区分目录，路径为 projectId / employeeId / path / title。
 */

import fs from "fs/promises";
import path from "path";

const WORKSPACE_DIR = ".bossman_workspace";

function getWorkspaceRoot(): string {
  return path.resolve(process.cwd(), WORKSPACE_DIR);
}

/** 确保路径在 root 内，禁止逃逸到 root 外 */
function ensureUnderRoot(root: string, resolvedPath: string): boolean {
  const r = path.resolve(root);
  const p = path.resolve(resolvedPath);
  return p === r || p.startsWith(r + path.sep);
}

/**
 * 返回项目工作区根目录的绝对路径。
 */
export function getProjectWorkspaceRoot(projectId: string): string {
  if (!projectId || /[\\/.]\./.test(projectId) || projectId.includes("..")) return "";
  const root = path.join(getWorkspaceRoot(), projectId);
  return path.resolve(root);
}

/**
 * 计算某文件在工作区内的相对路径：{employeeId}/{path}/{title}
 */
export function getFileRelativePath(employeeId: string, pathDir: string | null, title: string): string {
  if (!employeeId || !title) return "";
  const parts = [employeeId];
  if (pathDir != null && pathDir.trim() !== "") parts.push(pathDir.trim());
  parts.push(title);
  return path.join(...parts);
}

/**
 * 写入文件到工作区。路径为 .bossman_workspace/{projectId}/{employeeId}/{path}/{title}
 */
export async function writeWorkspaceFile(
  projectId: string,
  employeeId: string,
  pathDir: string | null,
  title: string,
  content: string
): Promise<string> {
  const root = getProjectWorkspaceRoot(projectId);
  if (!root) throw new Error("Invalid projectId for workspace");
  const relative = getFileRelativePath(employeeId, pathDir, title);
  if (!relative) throw new Error("Invalid path or title for workspace file");
  const absolute = path.resolve(root, relative);
  if (!ensureUnderRoot(root, absolute)) throw new Error("Path escapes workspace root");
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf-8");
  return relative.replace(/\\/g, "/");
}

/**
 * 从工作区读取文件内容。relativePath 为 getFileRelativePath 返回或 listWorkspaceFiles 中的 relativePath。
 */
export async function readWorkspaceFile(
  projectId: string,
  relativePath: string
): Promise<string | null> {
  const root = getProjectWorkspaceRoot(projectId);
  if (!root) return null;
  const absolute = path.resolve(root, relativePath);
  if (!ensureUnderRoot(root, absolute)) return null;
  try {
    const content = await fs.readFile(absolute, "utf-8");
    return content;
  } catch {
    return null;
  }
}

/**
 * 列出项目工作区下的结构（.bossman_workspace/{projectId}/{employeeId}/...），用于 Agent 或 UI。
 * 返回 { path: string, title: string, employeeId: string }[]，path 为相对路径。
 */
export async function listWorkspaceFiles(projectId: string): Promise<
  { relativePath: string; employeeId: string; pathDir: string; title: string }[]
> {
  const root = getProjectWorkspaceRoot(projectId);
  if (!root) return [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: { relativePath: string; employeeId: string; pathDir: string; title: string }[] = [];
  for (const emp of entries) {
    if (!emp.isDirectory()) continue;
    const empPath = path.join(root, emp.name);
    await collectFiles(empPath, emp.name, emp.name, "", results);
  }
  return results;
}

async function collectFiles(
  dir: string,
  prefix: string,
  employeeId: string,
  pathDir: string,
  out: { relativePath: string; employeeId: string; pathDir: string; title: string }[]
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.join(prefix, e.name);
    if (e.isDirectory()) {
      await collectFiles(full, rel, employeeId, pathDir ? `${pathDir}/${e.name}` : e.name, out);
    } else {
      out.push({
        relativePath: rel.replace(/\\/g, "/"),
        employeeId,
        pathDir,
        title: e.name,
      });
    }
  }
}

/**
 * 若 project.files 中某条 content 为空，则从工作区按 employeeId/path/title 读取并填充。
 * 用于 API 返回 project 时保证前端能拿到文件内容。
 */
export async function hydrateProjectFilesContent(project: {
  id: string;
  files?: { employeeId: string; path: string | null; title: string; content: string }[];
}): Promise<void> {
  if (!project.files?.length) return;
  for (const file of project.files) {
    if (file.content != null && file.content !== "") continue;
    const relative = getFileRelativePath(file.employeeId, file.path, file.title);
    if (!relative) continue;
    const content = await readWorkspaceFile(project.id, relative);
    if (content != null) (file as { content: string }).content = content;
  }
}
