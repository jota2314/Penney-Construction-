import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/constants/roles";
import { ApiKeyForm } from "@/components/settings/api-key-form";
import { QuickBooksConnect } from "@/components/settings/quickbooks-connect";
import { AiPersonalizationCard } from "@/components/settings/ai-personalization-card";
import { getUserAiInstructions, getUserMemories } from "@/lib/actions/ai-personalization";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings | Penney Construction" };

export default async function SettingsPage() {
  const user = await requireAuth();
  const supabase = await createClient();
  const profile = user.profile;
  const displayName = profile?.full_name ?? user.email;

  // Check QuickBooks connection status
  let qbConnected = false;
  let qbLastSync: string | null = null;
  try {
    const { data: qbSettings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["quickbooks_realm_id", "quickbooks_last_sync"]);
    qbConnected = !!(qbSettings?.find((s) => s.key === "quickbooks_realm_id")?.value);
    qbLastSync = qbSettings?.find((s) => s.key === "quickbooks_last_sync")?.value || null;
  } catch { /* table may not exist yet */ }

  const [aiInstructions, aiMemories] = await Promise.all([
    getUserAiInstructions(),
    getUserMemories(),
  ]);
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <Header title="Settings" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage
                  src={profile?.avatar_url ?? undefined}
                  alt={displayName}
                />
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-lg font-medium">{displayName}</h3>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Role
                </label>
                <div className="mt-1">
                  {profile?.role ? (
                    <Badge
                      className={ROLE_COLORS[profile.role]}
                      variant="secondary"
                    >
                      {ROLE_LABELS[profile.role]}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Not assigned
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Phone
                </label>
                <p className="mt-1 text-sm">
                  {profile?.phone ?? "Not provided"}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Member Since
                </label>
                <p className="mt-1 text-sm">
                  {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString()
                    : "--"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>QuickBooks</CardTitle>
            <CardDescription>
              Sync invoices, payments, and vendors from QuickBooks Online
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuickBooksConnect isConnected={qbConnected} lastSync={qbLastSync} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Test push notifications on this device. iOS requires the app to
              be opened from the home-screen icon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/test-push">
                <Bell className="h-4 w-4" />
                Open Notification Test
              </Link>
            </Button>
          </CardContent>
        </Card>

        <AiPersonalizationCard
          initialInstructions={aiInstructions}
          initialMemories={aiMemories}
          firstName={firstName}
        />

        <Card>
          <CardHeader>
            <CardTitle>AI Configuration</CardTitle>
            <CardDescription>
              Connect your Anthropic API key to power the Command Center AI
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeyForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
