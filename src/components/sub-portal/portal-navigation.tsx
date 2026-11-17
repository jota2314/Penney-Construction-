import { CalendarDays, HardHat, Phone, WalletCards } from "lucide-react";
import { telHref } from "@/lib/portal-kit/format";

type Tab = "today" | "dates" | "money";

export function PortalNavigation({
  company, officePhone, active, needed, answers, showMoney, onNavigate,
}: {
  company: string;
  officePhone: string;
  active: Tab;
  needed: number;
  answers: number;
  showMoney: boolean;
  onNavigate: (tab: Tab) => void;
}) {
  const tabs = [
    { key: "today", label: "Jobs", icon: HardHat, count: needed },
    { key: "dates", label: "Schedule", icon: CalendarDays, count: answers },
    ...(showMoney ? [{ key: "money" as const, label: "Billing", icon: WalletCards, count: 0 }] : []),
  ] as const;
  return (
    <header className="border-t-[3px] border-[var(--accent)] bg-[var(--ink)] text-white">
      <div className="pc-safe-top mx-auto grid w-full max-w-[76rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 sm:px-6 lg:min-h-[78px] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-3 py-3 lg:py-4">
          <span className="grid h-11 w-[62px] shrink-0 place-items-center rounded-md bg-white p-1 sm:h-12 sm:w-[70px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-email.jpg" alt="Penney Construction" className="h-full max-h-10 w-full object-contain" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/75 sm:text-[13px]">Subcontractor portal</p>
            <p className="break-words text-[15px] font-extrabold leading-tight sm:text-[18px]">{company}</p>
          </div>
        </div>
        <nav aria-label="Portal navigation" className="order-last col-span-2 flex min-w-0 gap-1 border-t border-white/15 lg:order-none lg:col-span-1 lg:gap-1.5 lg:rounded-xl lg:border lg:px-1 lg:py-1">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              aria-current={key === active ? "page" : undefined}
              onClick={() => onNavigate(key)}
              className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 border-b-[3px] px-1 text-sm font-bold lg:flex-none lg:rounded-lg lg:border-0 lg:px-4 ${key === active
                ? "border-[var(--accent)] text-white lg:bg-white lg:text-[var(--ink)]"
                : "border-transparent text-white/75 hover:text-white lg:hover:bg-white/10"}`}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {label}
              {count > 0 && <span aria-label={`${count} waiting`} className="rounded-full bg-[var(--accent-dark)] px-1.5 text-xs leading-5 text-white">{count}</span>}
            </button>
          ))}
        </nav>
        <a href={telHref(officePhone)} aria-label="Call the Penney office" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 justify-self-end rounded-lg border border-white/30 px-2.5 text-sm font-bold text-white hover:bg-white/10 sm:px-4">
          <Phone aria-hidden className="size-4" />
          <span className="hidden min-[440px]:inline">Call office</span>
        </a>
      </div>
    </header>
  );
}
