import { redirect } from "next/navigation";

// Single company mode: redirect to dashboard
export default function CompanyDetailPage() {
  redirect("/");
}
