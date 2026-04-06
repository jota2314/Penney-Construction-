import Image from "next/image";

export default function AppLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
      {/* Radial glow behind logo */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-[400px] w-[400px] animate-pulse rounded-full bg-amber-500/10 blur-[100px]" />
      </div>

      {/* Scanning line */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="loading-scan-line absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
      </div>

      {/* Logo */}
      <div className="loading-logo-reveal relative z-10 flex flex-col items-center gap-6">
        <div className="relative">
          {/* Glow ring */}
          <div className="loading-ring-spin absolute -inset-4 rounded-full border border-amber-500/20" />
          <div className="loading-ring-spin-reverse absolute -inset-8 rounded-full border border-amber-500/10" />

          <Image
            src="/logo.jpg"
            alt="Penney Construction"
            width={180}
            height={120}
            className="relative z-10 drop-shadow-[0_0_30px_rgba(217,119,6,0.3)]"
            priority
          />
        </div>

        {/* Tagline */}
        <div className="loading-text-reveal flex flex-col items-center gap-2">
          <p className="text-xs font-mono uppercase tracking-[0.35em] text-amber-500/70">
            Command Center
          </p>

          {/* Loading bar */}
          <div className="mt-2 h-[2px] w-32 overflow-hidden rounded-full bg-white/5">
            <div className="loading-bar h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" />
          </div>
        </div>
      </div>

      <style>{`
        .loading-logo-reveal {
          animation: logoReveal 0.8s ease-out both;
        }
        .loading-text-reveal {
          animation: logoReveal 0.8s ease-out 0.3s both;
        }
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.9) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .loading-scan-line {
          animation: scanDown 2s ease-in-out infinite;
        }
        @keyframes scanDown {
          0% { top: -2px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }

        .loading-ring-spin {
          animation: ringSpin 3s linear infinite;
        }
        .loading-ring-spin-reverse {
          animation: ringSpin 4s linear infinite reverse;
        }
        @keyframes ringSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .loading-bar {
          animation: barSlide 1.2s ease-in-out infinite;
        }
        @keyframes barSlide {
          0% { width: 0%; margin-left: 0; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
