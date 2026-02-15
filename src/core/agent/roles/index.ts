export { ceoRole } from "./ceo";
export { productManagerRole } from "./product-manager";
export { uiDesignerRole } from "./ui-designer";
export { frontendDevRole } from "./frontend-dev";
export { backendDevRole } from "./backend-dev";
export { qaEngineerRole } from "./qa-engineer";
export { researcherRole } from "./researcher";
export { creativeDirectorRole } from "./creative-director";

import { ceoRole } from "./ceo";
import { productManagerRole } from "./product-manager";
import { uiDesignerRole } from "./ui-designer";
import { frontendDevRole } from "./frontend-dev";
import { backendDevRole } from "./backend-dev";
import { qaEngineerRole } from "./qa-engineer";
import { researcherRole } from "./researcher";
import { creativeDirectorRole } from "./creative-director";
import type { AgentRoleDefinition } from "../types";

export const builtinRoles: AgentRoleDefinition[] = [
  ceoRole,
  productManagerRole,
  uiDesignerRole,
  frontendDevRole,
  backendDevRole,
  qaEngineerRole,
  researcherRole,
  creativeDirectorRole,
];
