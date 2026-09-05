"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, CheckCheck, Loader2, X } from "lucide-react";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/actions/notifications";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  enablePushNotifications,
  hasPushSubscription,
  supportsPushNotifications,
} from "@/lib/push/client";

function notificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

export function NotificationBell({ framed = false }: { framed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [canEnablePush, setCanEnablePush] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listMyNotifications();
    setNotifications(result.notifications);
    setUnreadCount(result.unreadCount);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Fetch once for the badge; opening the popover refreshes it again.
    void refresh();
    if (supportsPushNotifications()) {
      void hasPushSubscription().then((subscribed) =>
        setCanEnablePush(!subscribed),
      );
    }
  }, [refresh]);

  const enablePush = async () => {
    setEnablingPush(true);
    setPushError(null);
    try {
      await enablePushNotifications();
      setCanEnablePush(false);
    } catch (error) {
      setPushError(
        error instanceof Error ? error.message : "Could not enable notifications.",
      );
    } finally {
      setEnablingPush(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void refresh();
  };

  const markOne = (notificationId: string) => {
    setNotifications((current) =>
      current.map((item) =>
        item.id === notificationId
          ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
          : item,
      ),
    );
    if (notifications.some(item => item.id === notificationId && !item.readAt)) {
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    void markNotificationRead(notificationId);
    setOpen(false);
  };

  const markAll = () => {
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
    );
    setUnreadCount(0);
    void markAllNotificationsRead();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`relative inline-flex items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${framed ? "h-11 w-11 rounded-xl border" : "h-9 w-9 rounded-md"}`}
          style={framed ? { background: "var(--pcc-bg-2, var(--background))", borderColor: "var(--pcc-line, var(--border))" } : undefined}
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-none text-zinc-950">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} collisionPadding={12} className="flex w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(75dvh,var(--radix-popover-content-available-height))] flex-col overflow-hidden rounded-2xl p-0 shadow-2xl">
        <div className="shrink-0 border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PopoverTitle className="text-base font-semibold">Notifications</PopoverTitle>
              {unreadCount > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">{unreadCount} unread</span>}
            </div>
            <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-amber-500"><X className="h-4 w-4" /></button>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>
        {canEnablePush && (
          <div className="shrink-0 border-b bg-amber-500/5 px-4 py-3">
            <button
              type="button"
              onClick={enablePush}
              disabled={enablingPush}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 disabled:opacity-60"
            >
              {enablingPush ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <BellRing className="h-3.5 w-3.5" />
              )}
              Enable phone alerts
            </button>
            {pushError && (
              <p className="mt-2 text-[11px] text-red-400">{pushError}</p>
            )}
          </div>
        )}
        <div className="min-h-0 overflow-y-auto overscroll-contain" aria-label="Recent notifications">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Bell className="mb-1 h-7 w-7 text-muted-foreground/50" />
              <p className="text-sm font-medium">You’re all caught up</p>
              <p className="text-xs text-muted-foreground">New activity will appear here.</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <Link
                key={notification.id}
                href={notification.url}
                onClick={() => markOne(notification.id)}
                className={`block border-b border-border/50 px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-amber-500 focus-visible:-outline-offset-2 ${
                  notification.readAt ? "" : "bg-amber-500/[0.035]"
                }`}
              >
                <div className="flex gap-3">
                  <span aria-hidden="true" className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold ${notification.readAt ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-500"}`}>
                    {notification.actorName?.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("") || <Bell className="h-4 w-4" />}
                    {!notification.readAt && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-popover" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{notification.actorName || "Penney"}{!notification.readAt && <span className="sr-only"> · Unread</span>}</span>
                      <time dateTime={notification.createdAt} className="shrink-0">{notificationTime(notification.createdAt)}</time>
                    </div>
                    <p className={`text-[13px] leading-snug ${notification.readAt ? "font-medium text-foreground/80" : "font-semibold text-foreground"}`}>{notification.title}</p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {notification.body}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
