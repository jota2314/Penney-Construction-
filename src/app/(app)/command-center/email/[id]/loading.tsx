export default function EmailDetailLoading() {
  return (
    <div className="flex min-h-0 flex-1 animate-pulse flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="h-8 w-8 rounded-lg bg-muted" />
        <div className="h-4 w-20 rounded bg-muted" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex-1 space-y-4 overflow-hidden border-r p-4">
          <div className="space-y-2">
            <div className="h-5 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/3 rounded bg-muted" />
          </div>
          <div className="space-y-2 pt-3">
            <div className="h-3 w-full rounded bg-muted/70" />
            <div className="h-3 w-11/12 rounded bg-muted/70" />
            <div className="h-3 w-4/5 rounded bg-muted/70" />
            <div className="h-3 w-full rounded bg-muted/70" />
            <div className="h-3 w-2/3 rounded bg-muted/70" />
          </div>
        </div>
        <div className="hidden w-1/2 space-y-3 p-4 md:block">
          <div className="h-16 rounded-xl bg-muted/70" />
          <div className="h-24 rounded-xl bg-muted/50" />
        </div>
      </div>
    </div>
  );
}
