/**
 * Navigation fallback for the whole (app) segment.
 *
 * This renders on EVERY in-app navigation, so it must not cover the UI.
 * It used to be a full-screen `fixed inset-0 z-50 bg-black` splash with a
 * 0.8s reveal animation — which blacked out the sidebar and bottom nav and,
 * because it had no `pointer-events-none`, swallowed any click made while a
 * page was loading. That's what made every navigation take two clicks.
 *
 * Now: a thin indeterminate progress bar pinned to the top. Nav chrome stays
 * visible and clickable the entire time.
 */
export default function AppLoading() {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50"
      role="status"
      aria-label="Loading"
    >
      <div className="h-[3px] w-full overflow-hidden bg-amber-500/10">
        <div className="nav-progress h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
      </div>

      <style>{`
        .nav-progress {
          animation: navProgress 1.1s ease-in-out infinite;
        }
        @keyframes navProgress {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nav-progress {
            animation: none;
            width: 100%;
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
}
