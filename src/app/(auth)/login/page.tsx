import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground text-2xl font-bold">
            PC
          </div>
          <CardTitle className="text-2xl">Penney Construction</CardTitle>
          <CardDescription>
            Pre-Construction &amp; Estimating Platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleSignInButton />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Sign in with your authorized Google account to access the platform.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
