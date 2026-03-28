"use client";

import { useState } from "react";
import { ProjectBoard } from "./project-board";
import { QuotePipeline } from "./quote-pipeline";
import { ClientUpdates } from "./client-updates";
import { FollowUpsList } from "./follow-ups-list";
import type {
  QuoteRequest,
  FollowUp,
  ClientUpdate,
  QuoteRequestStatus,
} from "@/types/database";

interface TabData {
  projects: Array<{
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    phase: string | null;
    status: string;
    quote_count: number;
    next_action: string | null;
    progress: number;
    subcontractor_names: string[];
  }>;
  quotes: QuoteRequest[];
  quoteCounts: Record<string, number>;
  followUps: FollowUp[];
  clientUpdates: ClientUpdate[];
}

const TABS = [
  { key: "projects", label: "Projects" },
  { key: "follow-ups", label: "Follow-ups" },
  { key: "quotes", label: "Quotes" },
  { key: "clients", label: "Clients" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function CommandCenterTabs({ data }: { data: TabData }) {
  const [activeTab, setActiveTab] = useState<TabKey>("projects");
  const [quoteFilter, setQuoteFilter] = useState<QuoteRequestStatus | null>(
    null
  );

  const filteredQuotes = quoteFilter
    ? data.quotes.filter((q) => q.status === quoteFilter)
    : data.quotes;

  const tabCounts: Record<TabKey, number> = {
    projects: data.projects.length,
    "follow-ups": data.followUps.filter((f) => f.status === "open").length,
    quotes: data.quotes.length,
    clients: data.clientUpdates.length,
  };

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {tab.label}
            {tabCounts[tab.key] > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key
                    ? "bg-primary-foreground/20"
                    : "bg-muted"
                }`}
              >
                {tabCounts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === "projects" && (
          <ProjectBoard projects={data.projects} />
        )}
        {activeTab === "follow-ups" && (
          <FollowUpsList followUps={data.followUps} />
        )}
        {activeTab === "quotes" && (
          <QuotePipeline
            quotes={filteredQuotes}
            statusCounts={data.quoteCounts}
            activeFilter={quoteFilter}
            onFilterChange={setQuoteFilter}
          />
        )}
        {activeTab === "clients" && (
          <ClientUpdates updates={data.clientUpdates} />
        )}
      </div>
    </div>
  );
}
