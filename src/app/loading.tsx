import { Skeleton } from "@/components/ui/skeleton";
import { FeedSkeleton } from "@/components/news/news-feed";

export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="h-14 border-b" />
      <div className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:px-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <FeedSkeleton rows={4} />
      </div>
    </div>
  );
}
