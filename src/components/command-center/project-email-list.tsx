import { Badge } from "@/components/ui/badge";
import { Mail, ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface EmailLogEntry {
  id: string;
  subject: string;
  from_email: string;
  to_email: string;
  direction: "inbound" | "outbound";
  category: string;
  sent_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  quote: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  sub_outreach: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  client_update: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  follow_up: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  internal: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  other: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

interface ProjectEmailListProps {
  emails: EmailLogEntry[];
}

export function ProjectEmailList({ emails }: ProjectEmailListProps) {
  if (emails.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No emails synced yet. Click &quot;Pull Emails from Gmail&quot; to sync.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map((email) => {
        const date = new Date(email.sent_at);
        const dateStr = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const timeStr = date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });

        return (
          <div
            key={email.id}
            className="rounded-lg border bg-card p-3 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="mt-0.5">
                {email.direction === "inbound" ? (
                  <ArrowDownLeft className="h-4 w-4 text-blue-400" />
                ) : (
                  <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{email.subject}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {email.direction === "inbound" ? "From: " : "To: "}
                  {email.direction === "inbound"
                    ? email.from_email
                    : email.to_email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  CATEGORY_COLORS[email.category] || CATEGORY_COLORS.other
                }`}
              >
                {email.category.replace("_", " ").toUpperCase()}
              </Badge>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {dateStr} {timeStr}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
