"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">页面出错了</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message || "渲染页面时发生未知错误。"}</p>
        <Button className="mt-6" onClick={reset}>
          重新加载
        </Button>
      </div>
    </div>
  );
}
