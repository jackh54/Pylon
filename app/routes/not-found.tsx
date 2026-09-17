import { data } from "react-router";
import type { Route } from "./+types/not-found";

export function loader() {
  throw data("Not found", { status: 404 });
}

export const meta: Route.MetaFunction = () => [{ title: "Not found" }, { name: "robots", content: "noindex" }];

export default function NotFound() {
  return null;
}
