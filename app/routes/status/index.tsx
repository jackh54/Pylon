import type { Route } from "./+types/index";
import { findShellData } from "./_shared";
import { StatusIndexView, statusIndexMeta } from "~/components/status-index-view";

export const meta: Route.MetaFunction = ({ matches }) => statusIndexMeta(findShellData(matches));

export default function StatusIndex() {
  return <StatusIndexView />;
}
