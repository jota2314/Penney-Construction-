import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Server mode: the WebView loads the deployed Next.js app directly.
 * This is required because the app uses server actions, API routes,
 * Supabase SSR cookies, middleware, and Gmail OAuth — none of which
 * work with a static export bundle.
 *
 * To point at a local dev server while iterating, change `server.url`
 * to your machine's LAN IP (e.g. http://192.168.1.20:3000) and add
 * `cleartext: true`.
 */
const config: CapacitorConfig = {
  appId: "com.penneyconstruction.app",
  appName: "Penney Construction",
  webDir: "capacitor-web",
  server: {
    url: "https://penney-construction-mf6m.vercel.app",
    androidScheme: "https",
    iosScheme: "https",
    allowNavigation: [
      "penney-construction-mf6m.vercel.app",
      "*.vercel.app",
      "accounts.google.com",
      "*.googleusercontent.com",
      "*.google.com",
      "kozgjatzmllhvqwqbzzy.supabase.co",
      "*.supabase.co",
    ],
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#0f0f10",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0f0f10",
      showSpinner: false,
      iosSpinnerStyle: "small",
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0f0f10",
      overlaysWebView: true,
    },
  },
};

export default config;
