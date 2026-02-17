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

export default async function SettingsPage() {
  const user = await requireAuth();
  const profile = user.profile;
  const displayName = profile?.full_name ?? user.email;

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <Header title="Settings" />
      <div className="flex flex-1 flex-col gap-6 p-6">
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
      </div>
    </>
  );
}
