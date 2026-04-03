"use client";

import { useState, useEffect } from "react";
import {
  HardHat,
  Clock,
  Camera,
  AlertTriangle,
  Package,
  CheckCircle,
  Wrench,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface TimeEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  hourly_rate: number | null;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
}

interface FieldPhoto {
  id: string;
  file_name: string;
  storage_path: string;
  photo_type: string;
  caption: string | null;
}

interface FieldNote {
  id: string;
  content: string;
  note_type: string;
  source: string;
}

interface DayReport {
  date: string;
  entries: (TimeEntry & { photos: FieldPhoto[]; notes: FieldNote[] })[];
  totalHours: number;
  totalCost: number;
}

interface ProjectProductionTabProps {
  projectId: string;
  timeEntries: TimeEntry[];
}

const NOTE_ICONS: Record<string, { icon: typeof Wrench; color: string; label: string }> = {
  completed_work: { icon: CheckCircle, label: "Work Done", color: "text-emerald-400" },
  problem: { icon: AlertTriangle, label: "Problem", color: "text-red-400" },
  material_needed: { icon: Package, label: "Material", color: "text-amber-400" },
  general: { icon: Wrench, label: "Note", color: "text-sky-400" },
};

export function ProjectProductionTab({
  projectId,
  timeEntries,
}: ProjectProductionTabProps) {
  const [fieldData, setFieldData] = useState<
    Record<string, { photos: FieldPhoto[]; notes: FieldNote[] }>
  >({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load field report data for all time entries
  useEffect(() => {
    if (loaded || timeEntries.length === 0) return;
    setLoaded(true);

    const supabase = createClient();
    const entryIds = timeEntries.map((e) => e.id);

    Promise.all([
      supabase
        .from("field_report_photos")
        .select("id, time_entry_id, file_name, storage_path, photo_type, caption")
        .in("time_entry_id", entryIds),
      supabase
        .from("field_report_notes")
        .select("id, time_entry_id, content, note_type, source")
        .in("time_entry_id", entryIds),
    ]).then(([photosRes, notesRes]) => {
      const data: Record<string, { photos: FieldPhoto[]; notes: FieldNote[] }> = {};
      for (const entry of timeEntries) {
        data[entry.id] = { photos: [], notes: [] };
      }
      for (const p of photosRes.data ?? []) {
        if (data[p.time_entry_id]) data[p.time_entry_id].photos.push(p);
      }
      for (const n of notesRes.data ?? []) {
        if (data[n.time_entry_id]) data[n.time_entry_id].notes.push(n);
      }
      setFieldData(data);
    });
  }, [timeEntries, loaded]);

  // Group entries by day
  const dayReports: DayReport[] = [];
  const dayMap = new Map<string, (TimeEntry & { photos: FieldPhoto[]; notes: FieldNote[] })[]>();

  for (const entry of timeEntries) {
    const date = entry.clock_in.split("T")[0];
    if (!dayMap.has(date)) dayMap.set(date, []);
    const fd = fieldData[entry.id] || { photos: [], notes: [] };
    dayMap.get(date)!.push({ ...entry, ...fd });
  }

  for (const [date, entries] of Array.from(dayMap).sort((a, b) => b[0].localeCompare(a[0]))) {
    let totalHours = 0;
    let totalCost = 0;
    for (const e of entries) {
      if (!e.clock_out) continue;
      const hours = Math.max(
        0,
        (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / (1000 * 60 * 60) -
          (e.break_minutes || 0) / 60
      );
      totalHours += hours;
      totalCost += hours * (e.hourly_rate || 0);
    }
    dayReports.push({ date, entries, totalHours: Math.round(totalHours * 10) / 10, totalCost: Math.round(totalCost) });
  }

  // Summary stats
  const grandTotalHours = dayReports.reduce((s, d) => s + d.totalHours, 0);
  const grandTotalCost = dayReports.reduce((s, d) => s + d.totalCost, 0);
  const totalPhotos = Object.values(fieldData).reduce((s, d) => s + d.photos.length, 0);
  const totalNotes = Object.values(fieldData).reduce((s, d) => s + d.notes.length, 0);
  const totalProblems = Object.values(fieldData).reduce(
    (s, d) => s + d.notes.filter((n) => n.note_type === "problem").length,
    0
  );

  async function loadPhotoUrl(storagePath: string) {
    if (photoUrls[storagePath]) return;
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("project-files")
      .createSignedUrl(storagePath, 3600);
    if (data?.signedUrl) {
      setPhotoUrls((prev) => ({ ...prev, [storagePath]: data.signedUrl }));
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-orange-500" />
          <h3 className="text-sm font-semibold">Production</h3>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span><strong className="text-foreground">{Math.round(grandTotalHours)}</strong> hours</span>
          <span><strong className="text-foreground">${grandTotalCost.toLocaleString()}</strong> labor</span>
          <span><strong className="text-foreground">{dayReports.length}</strong> days</span>
          {totalPhotos > 0 && <span>{totalPhotos} photos</span>}
          {totalProblems > 0 && <span className="text-red-400">{totalProblems} problems</span>}
        </div>
      </div>

      {dayReports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <HardHat className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No production data yet</p>
          <p className="text-xs mt-1">Crew hours and field reports will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dayReports.map((day) => {
            const isExpanded = expandedDay === day.date;
            const dayPhotos = day.entries.flatMap((e) => e.photos);
            const dayNotes = day.entries.flatMap((e) => e.notes);
            const dayLabel = new Date(day.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });

            return (
              <div key={day.date} className="rounded-lg border overflow-hidden">
                {/* Day header */}
                <button
                  onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                  className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{dayLabel}</span>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>{day.totalHours}h</span>
                      <span>${day.totalCost}</span>
                      <span>{day.entries.length} {day.entries.length === 1 ? "worker" : "workers"}</span>
                    </div>
                    {dayPhotos.length > 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <Camera className="h-3 w-3" /> {dayPhotos.length}
                      </span>
                    )}
                    {dayNotes.some((n) => n.note_type === "problem") && (
                      <span className="text-xs text-red-400 flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" /> Problem
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t p-3 space-y-3 bg-muted/10">
                    {/* Worker entries */}
                    {day.entries.map((entry) => {
                      const name = entry.employee_name || "Unknown";
                      const clockIn = new Date(entry.clock_in).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      const clockOut = entry.clock_out
                        ? new Date(entry.clock_out).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Active";
                      let hours = 0;
                      if (entry.clock_out) {
                        hours = Math.round(
                          ((new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) / (1000 * 60 * 60) -
                            (entry.break_minutes || 0) / 60) *
                            10
                        ) / 10;
                      }

                      return (
                        <div key={entry.id} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm font-medium">{name}</span>
                              <span className="text-xs text-muted-foreground">
                                {clockIn} — {clockOut}
                              </span>
                            </div>
                            <span className="text-xs font-medium">{hours}h</span>
                          </div>

                          {/* Notes for this entry */}
                          {entry.notes.length > 0 && (
                            <div className="ml-5 space-y-1">
                              {entry.notes.map((note) => {
                                const config = NOTE_ICONS[note.note_type] || NOTE_ICONS.general;
                                const Icon = config.icon;
                                return (
                                  <div key={note.id} className="flex items-start gap-2 text-xs">
                                    <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${config.color}`} />
                                    <span>{note.content}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Photos for this entry */}
                          {entry.photos.length > 0 && (
                            <div className="ml-5 grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                              {entry.photos.map((photo) => {
                                if (!photoUrls[photo.storage_path]) {
                                  loadPhotoUrl(photo.storage_path);
                                }
                                return (
                                  <div
                                    key={photo.id}
                                    className="aspect-square rounded-md overflow-hidden bg-muted relative"
                                  >
                                    {photoUrls[photo.storage_path] ? (
                                      <img
                                        src={photoUrls[photo.storage_path]}
                                        alt={photo.file_name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white px-1 py-0.5 truncate">
                                      {photo.photo_type}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
