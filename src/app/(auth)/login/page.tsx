import type { Metadata } from "next";
import Link from "next/link";
import { HardHat } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export const metadata: Metadata = { title: "Sign In | Penney Construction" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#4A4543] via-[#3D3835] to-[#2E2A28] px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Penney Construction"
            className="h-28 w-auto mb-2"
          />
        </div>

        {/* Sign-in card */}
        <Card className="border-0 shadow-2xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription className="text-sm">
              Sign in to your pre-construction platform
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <GoogleSignInButton />
            <p className="text-center text-xs text-muted-foreground">
              Use your authorized Google account to access the platform.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Subs sign in with phone + PIN, not Google. */}
            <Link
              href="/sub"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <HardHat className="h-4 w-4" />
              Subcontractor sign in
            </Link>
            <p className="text-center text-xs text-muted-foreground">
              Subs use your phone number and PIN.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-white/40">
          Penney Construction, Inc.
        </p>
      </div>
    </div>
  );
}
