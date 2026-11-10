"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronDown, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { updateWebsiteInquiry } from "@/lib/actions/website-inquiries";
import { INTAKE_LABELS, inquiryDueDay, inquiryText, intakeStatus, isHandedOffStatus, nextFollowUpDay, type Inquiry, type IntakeStatus } from "@/lib/inquiries/model";

/** Stages the office can pick from the card. A walkthrough is booked, not picked. */
const PICKABLE: IntakeStatus[] = ["new", "contacted", "lead", "estimating", "proposal_sent", "won"];
const OFF_THE_LINE: IntakeStatus[] = ["closed", "spam"];

/**
 * The stage pill on an inquiry card. Click it to move the lead to another
 * stage without opening the inquiry. It keeps the owner and follow-up date,
 * and uses the next weekday when an open stage has no date or an old one.
 */
export function InquiryStageMenu({ inquiry, assignees, readOnly, colorClass, onMessage }: {
  inquiry: Inquiry;
  assignees: string[];
  readOnly: boolean;
  colorClass: string;
  onMessage: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const current = intakeStatus(inquiry);
  const pill = `inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${colorClass}`;
  if (readOnly) return <span className={pill}>{INTAKE_LABELS[current]}</span>;

  function choose(next: IntakeStatus) {
    if (next === current || pending) return;
    const owner = inquiry.assignee && assignees.includes(inquiry.assignee) ? inquiry.assignee
      : assignees.includes("Shannon") ? "Shannon" : assignees[0] || "";
    const keptDay = inquiry.due_date && Date.parse(inquiry.due_date) > Date.now() ? inquiryDueDay(inquiry.due_date) : "";
    const dueDay = isHandedOffStatus(next) ? "" : keptDay || nextFollowUpDay();
    setError("");
    startTransition(async () => {
      try {
        const result = await updateWebsiteInquiry({ id: inquiry.id, expectedUpdatedAt: inquiry.updated_at, status: next, assignee: owner, dueDay });
        if (result.error) {
          // Someone (or the automatic stage job) changed it first: load the latest and let them retry.
          if (/changed/i.test(result.error)) { setError("This lead just changed. Check its stage and try again."); router.refresh(); }
          else setError(result.error);
          return;
        }
        onMessage(`${inquiryText(inquiry, "name") || "Lead"} moved to ${INTAKE_LABELS[next]}.`);
        router.refresh();
      } catch { setError("The stage could not be saved. Please try again."); }
    });
  }

  const options = [...PICKABLE, ...(current === "qualified" ? ["qualified" as IntakeStatus] : [])];
  return <div className="flex shrink-0 flex-col items-end">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={pending} aria-label={`Stage: ${INTAKE_LABELS[current]}. Change stage`} className={`${pill} cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60`}>
          {pending && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
          {INTAKE_LABELS[current]}
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Move this lead to</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => choose(value as IntakeStatus)}>
          {current === "walkthrough" && <DropdownMenuRadioItem value="walkthrough">{INTAKE_LABELS.walkthrough}</DropdownMenuRadioItem>}
          {options.map((status) => <DropdownMenuRadioItem key={status} value={status}>{INTAKE_LABELS[status]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {current !== "walkthrough" && <DropdownMenuItem asChild>
          <Link href={`/command-center/inquiries/${inquiry.id}#walkthrough`}><CalendarClock aria-hidden="true" />Book walkthrough…</Link>
        </DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => choose(value as IntakeStatus)}>
          {OFF_THE_LINE.map((status) => <DropdownMenuRadioItem key={status} value={status}>{INTAKE_LABELS[status]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {error && <p role="alert" className="mt-1 max-w-52 text-right text-xs text-destructive">{error}</p>}
  </div>;
}
