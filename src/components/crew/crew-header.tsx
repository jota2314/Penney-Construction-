"use client";

import Image from "next/image";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { CrewLocationDot } from "./crew-location-dot";

interface CrewHeaderProps {
  fullName: string | null;
  avatarUrl: string | null;
}

export function CrewHeader({ fullName, avatarUrl }: CrewHeaderProps) {
  const initials = fullName
    ? fullName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border/50">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.jpg"
            alt="Penney Construction"
            width={28}
            height={28}
            className="rounded"
          />
          <span className="font-semibold text-sm">Crew</span>
          <CrewLocationDot />
        </div>

        <div className="flex items-center gap-1">
          <NotificationBell />
          <ThemeToggle />
          <Avatar className="h-8 w-8">
            <AvatarImage src={avatarUrl || undefined} alt={fullName || "User"} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
