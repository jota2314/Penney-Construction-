import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketingLoading() {
  return <><Header title="Marketing" /><div className="space-y-7 p-4 sm:p-6" role="status" aria-label="Loading marketing library"><div className="space-y-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-10 w-4/5 max-w-lg" /><Skeleton className="h-5 w-3/4 max-w-xl" /></div><Skeleton className="h-20 w-full" /><div className="grid grid-cols-1 gap-5 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{[1, 2, 3, 4].map(item => <Skeleton key={item} className="aspect-[4/5] rounded-2xl" />)}</div><span className="sr-only">Loading marketing library</span></div></>;
}
