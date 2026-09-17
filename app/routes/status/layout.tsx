import { Outlet, data } from "react-router";
import type { Route } from "./+types/layout";
import { StatusShell } from "~/components/status-shell";
import { loadStatusShell, statusShellAction } from "./shell.server";

export async function loader(args: Route.LoaderArgs) {
  const { body, headers } = await loadStatusShell(args);
  return data(body, { headers });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export async function action(args: Route.ActionArgs) {
  return statusShellAction(args);
}

export default function StatusLayout({ loaderData, actionData }: Route.ComponentProps) {
  return <StatusShell data={loaderData} error={actionData && "error" in actionData ? actionData.error : undefined}><Outlet /></StatusShell>;
}
