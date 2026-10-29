import { loadClientDay } from "@/lib/data";

// Typed by hand: the static export excludes this file, so Next's generated RouteContext type is absent there.
export async function GET(_request: Request, ctx: { params: Promise<{ day: string }> }) {
  const { day } = await ctx.params;
  const data = await loadClientDay(day);
  if (!data) return Response.json({ error: "没有这一天的数据" }, { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
