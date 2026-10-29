import { SITE } from "@/config/site";

/** True in the GitHub Pages build: no server, no refresh API. */
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** "owner/repo", injected from GITHUB_REPOSITORY when built in GitHub Actions. */
export const REPO = process.env.NEXT_PUBLIC_REPO ?? "";
export const REPO_URL = REPO ? `https://github.com/${REPO}` : "";
export const WORKFLOW_URL = REPO ? `${REPO_URL}/actions/workflows/${SITE.workflowFile}` : "";

export function dayDataUrl(day: string): string {
  return IS_STATIC ? `${BASE_PATH}/data/days/${day}.json` : `/api/days/${day}`;
}
