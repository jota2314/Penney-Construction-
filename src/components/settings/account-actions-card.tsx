"use client";

import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signOut, reconnectGoogle } from "@/lib/auth/actions";

/**
 * Mobile-friendly Account actions on the Settings page.
 * Sign Out lives here because the sidebar (which holds the avatar
 * dropdown on desktop) is hidden below 768px — phone users had no
 * way to log out otherwise.
 */
export function AccountActionsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          Manage your Google connection and sign out of the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <form action={reconnectGoogle}>
          <Button type="submit" variant="outline" className="gap-2 w-full sm:w-auto">
            <RefreshCw className="h-4 w-4" />
            Reconnect Google
          </Button>
        </form>
        <form action={signOut}>
          <Button
            type="submit"
            variant="outline"
            className="gap-2 w-full sm:w-auto text-red-500 hover:text-red-500 hover:bg-red-500/10 border-red-500/30"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
