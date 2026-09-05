import { CrewViewport } from "../../src/components/crew/crew-viewport";
import { CrewScrollArea } from "../../src/components/crew/crew-scroll-area";
import { CrewBottomNav } from "../../src/components/crew/crew-bottom-nav";
import { CrewLayoutDiagnostics } from "../../src/components/crew/crew-layout-diagnostics";

export default function Page() {
  return <CrewViewport>
    <header className="shrink-0 p-4 border-b"><CrewLayoutDiagnostics /></header>
    <CrewScrollArea>
      <div className="p-4 space-y-4">
        <h1>Daily log</h1>
        <textarea aria-label="Daily log" className="w-full border p-4" />
        {Array.from({length: 30}, (_, i) => <div key={i} className="p-4 border rounded-xl">Test assignment {i + 1}</div>)}
      </div>
    </CrewScrollArea>
    <CrewBottomNav />
  </CrewViewport>;
}
