import { createContext } from "react-router";
import type { AuthState } from "@server/auth/session";

export interface CloudflareContext {
  env: Env;
  ctx: ExecutionContext;
  /** set when the request came in on a status page's custom domain */
  customDomainSlug?: string;
  /** that page's favicon, so the document head can use it instead of the Pylon default */
  customDomainFavicon?: string;
}

export const cloudflareContext = createContext<CloudflareContext>();
export const authContext = createContext<AuthState | null>(null);
