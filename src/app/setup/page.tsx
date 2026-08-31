import { redirect } from "next/navigation";
import { hasUsers } from "@/lib/db";
import SetupForm from "./setup-form";

export default function SetupPage() {
  if (hasUsers()) redirect("/login");
  return <SetupForm />;
}
