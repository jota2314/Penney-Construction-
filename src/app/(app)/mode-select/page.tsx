import { ModeSelector } from "@/components/layout/mode-selector";

export default function ModeSelectPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Choose Your Mode</h1>
        <p className="mt-2 text-muted-foreground">
          Select which part of the platform you&apos;d like to work in.
        </p>
      </div>
      <ModeSelector />
    </div>
  );
}
