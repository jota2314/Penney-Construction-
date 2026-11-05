/** A page-sized fallback, never an overlay over navigation or fake cash totals. */
export function CommandCenterLoading({ firstName }: { firstName?: string | null }) {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", hourCycle: "h23",
  }).format(now));
  const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  const date = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
  });

  return (
    <div className="min-h-screen bg-[#0E0D0B] px-3.5 pt-6 pb-32 text-[#F5F1EA] lg:px-8 lg:py-8">
      <div className="mx-auto flex max-w-[460px] flex-col gap-4 lg:max-w-[1320px] lg:gap-5">
        <header>
          <p className="mb-1.5 text-[11px] text-[#A8A29E] lg:text-xs">{date}</p>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight lg:text-[32px]">
            {firstName ? <>{greeting}, <span className="text-[#D97706]">{firstName}</span></> : "Command Center"}
          </h1>
        </header>
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading your Command Center</span>
          <div aria-hidden="true" className="flex flex-col gap-4 motion-safe:animate-pulse">
            <div className="h-24 rounded-2xl border border-white/5 bg-[#16140F]" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((tile) => <div key={tile} className="h-28 rounded-2xl border border-white/5 bg-[#16140F]" />)}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((post) => (
                <div key={post} className="h-72 rounded-2xl border border-white/5 bg-[#16140F] p-4">
                  <div className="mb-6 h-3 w-32 rounded bg-white/5" />
                  <div className="h-2 w-3/4 rounded bg-white/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

