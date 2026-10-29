import { getRunnerState, startRefresh } from "@/lib/pipeline/runner";
import { toRefreshStatus } from "@/lib/refresh-status";

export async function POST() {
  const { started } = startRefresh("manual");
  return Response.json(toRefreshStatus(getRunnerState()), { status: started ? 202 : 409 });
}
