"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, CheckCheck, Loader2 } from "lucide-react";
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
    setUnreadCount((current) => Math.max(0, current - 1));
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
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <PopoverTitle>Notifications</PopoverTitle>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-500"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>
        {canEnablePush && (
          <div className="border-b bg-amber-500/5 px-4 py-3">
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
        <div className="max-h-[min(28rem,70dvh)] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            notifications.map((notification) => (
              <Link
                key={notification.id}
                href={notification.url}
                onClick={() => markOne(notification.id)}
                className={`block border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/60 ${
                  notification.readAt ? "" : "bg-amber-500/5"
                }`}
              >
                <div className="flex gap-2">
                  {!notification.readAt && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{notification.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {notification.body}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      {new Date(notification.createdAt).toLocaleString()}
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
