import { z } from "zod";

export const CreateCompanySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  description: z.string().optional(),
});

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export const HireEmployeeSchema = z.object({
  companyId: z.string(),
  roleId: z.string(),
  name: z.string().min(1, "Employee name is required"),
});

export type HireEmployeeInput = z.infer<typeof HireEmployeeSchema>;
