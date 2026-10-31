import { readInvestStatus } from "@/lib/invest/store";

export async function GET() {
  const status = await readInvestStatus();
  if (!status) return Response.json({ error: "还没有更新记录" }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
