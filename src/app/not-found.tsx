import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <p className="text-5xl font-bold text-muted-foreground/40">404</p>
        <h1 className="mt-3 text-lg font-semibold">页面不存在</h1>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">返回首页</Link>
        </Button>
      </div>
    </div>
  );
}
