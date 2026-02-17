"use client";

import { signOut } from "@/lib/auth/actions";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut()}
      className="flex w-full items-center gap-2"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </button>
  );
}
