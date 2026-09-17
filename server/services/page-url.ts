/* Pure helper (safe for any module): the public base URL of a status page. */
export interface PageUrlFields { slug: string; customDomain: string | null; customDomainVerifiedAt?: number | null }

/** Custom domain once verified, otherwise the path on the app host. No trailing slash. */
export function pageBaseUrl(appUrl: string, page: PageUrlFields): string {
  if (page.customDomain && page.customDomainVerifiedAt) return `https://${page.customDomain}`;
  return `${appUrl.replace(/\/$/, "")}/s/${page.slug}`;
}
