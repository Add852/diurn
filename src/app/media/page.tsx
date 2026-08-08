import { redirect } from "next/navigation";

export default function MediaRedirect() {
  redirect("/viewer?mode=media");
}