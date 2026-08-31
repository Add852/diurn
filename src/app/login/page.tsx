import { redirect } from "next/navigation";
import { hasUsers } from "@/lib/db";
import LoginForm from "./login-form";

export default function LoginPage() {
  if (!hasUsers()) redirect("/setup");
  return <LoginForm />;
}
