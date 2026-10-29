import { getRunnerState } from "@/lib/pipeline/runner";
import { toRefreshStatus } from "@/lib/refresh-status";

export async function GET() {
  return Response.json(toRefreshStatus(getRunnerState()), {
    headers: { "Cache-Control": "no-store" },
  });
}
