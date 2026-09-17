import { createContext } from "react-router";
import type { AuthState } from "@server/auth/session";

export interface CloudflareContext {
  env: Env;
  ctx: ExecutionContext;
  /** set when the request came in on a status page's custom domain */
  customDomainSlug?: string;
}

export const cloudflareContext = createContext<CloudflareContext>();
export const authContext = createContext<AuthState | null>(null);
