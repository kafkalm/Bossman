import "dotenv/config";

/**
 * Resume any in-progress projects on server startup.
 * Uses dynamic imports so Prisma (Node-only) is never loaded in Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    const { prisma } = await import("@/lib/db");
    const { projectWorkflow } = await import("@/core/project");

    const projects = await prisma.project.findMany({
      where: { status: "in_progress" },
      include: {
        company: {
          include: {
            employees: { include: { role: true } },
          },
        },
      },
    });

    const validProjects = projects.filter((p) => {
      if (!p.company?.employees?.length) {
        console.warn(
          `[Bossman] Skipping project "${p.name}" - company has no employees`
        );
        return false;
      }
      const ceo = p.company.employees.find(
        (e) => e.role?.name === "ceo"
      );
      if (!ceo) {
        console.warn(
          `[Bossman] Skipping project "${p.name}" - no CEO found`
        );
        return false;
      }
      return true;
    });

    if (validProjects.length === 0) return;

    console.log(
      `[Bossman] Resuming ${validProjects.length} in-progress project(s): ${validProjects.map((p) => p.name).join(", ")}`
    );

    for (const p of validProjects) {
      projectWorkflow.resumeProject(p.id).catch((err) => {
        console.error(`[Bossman] Failed to resume project ${p.name}:`, err);
      });
    }
  } catch (err) {
    console.error("[Bossman] Error resuming projects on startup:", err);
  }
}
