"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  FileSpreadsheet,
  Download,
  Loader2,
  CheckCircle,
  AlertTriangle,
  FolderOpen,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

interface Project {
  id: string;
  name: string;
  project_number: string;
}

interface ImportResult {
  success: boolean;
  file_name: string;
  project_name: string | null;
  project_id: string | null;
  line_items: number;
  total_price: number;
  needs_project_assignment?: boolean;
  error?: string;
}

export function DriveEstimateImporter({ projects }: { projects: Project[] }) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, ImportResult>>(new Map());
  const [projectOverrides, setProjectOverrides] = useState<Record<string, string>>({});
  const router = useRouter();

  useEffect(() => {
    fetchFiles();
  }, []);

  async function fetchFiles() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/drive-estimates");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Drive files");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(file: DriveFile) {
    setImporting(file.id);
    try {
      const res = await fetch("/api/drive-estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          projectId: projectOverrides[file.id] || null,
        }),
      });
      const data = await res.json();

      setResults((prev) => new Map(prev).set(file.id, {
        success: !data.error,
        file_name: file.name,
        project_name: data.project_name || null,
        project_id: data.project_id || null,
        line_items: data.line_items || 0,
        total_price: data.total_price || 0,
        needs_project_assignment: data.needs_project_assignment,
        error: data.error,
      }));
    } catch (err) {
      setResults((prev) => new Map(prev).set(file.id, {
        success: false,
        file_name: file.name,
        project_name: null,
        project_id: null,
        line_items: 0,
        total_price: 0,
        error: err instanceof Error ? err.message : "Import failed",
      }));
    } finally {
      setImporting(null);
    }
  }

  const fmt = (n: number) => "$" + n.toLocaleString();
  const importedCount = Array.from(results.values()).filter(r => r.success).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-amber-500" />
            Google Drive Estimates
          </h3>
          <p className="text-sm text-muted-foreground">
            {files.length} spreadsheets found
            {importedCount > 0 && <span className="text-emerald-400 ml-2">{importedCount} imported</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading files from Google Drive...</p>
        </div>
      )}

      {!loading && files.length === 0 && !error && (
        <div className="text-center py-12 text-muted-foreground">
          <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No spreadsheets found in Google Drive</p>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => {
            const result = results.get(file.id);
            const isImporting = importing === file.id;
            const isImported = result?.success;

            return (
              <div
                key={file.id}
                className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${
                  isImported ? "border-emerald-500/30 bg-emerald-500/5" : ""
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <FileSpreadsheet className={`h-5 w-5 shrink-0 ${isImported ? "text-emerald-400" : "text-amber-500"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(file.modifiedTime).toLocaleDateString()}
                      {result?.success && (
                        <span className="text-emerald-400 ml-2">
                          Imported: {result.line_items} lines, {fmt(result.total_price)}
                          {result.project_name && ` → ${result.project_name}`}
                        </span>
                      )}
                      {result?.error && (
                        <span className="text-red-400 ml-2">{result.error}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Project override selector */}
                  <select
                    value={projectOverrides[file.id] || ""}
                    onChange={(e) => setProjectOverrides((prev) => ({ ...prev, [file.id]: e.target.value }))}
                    className="text-xs bg-background border rounded px-2 py-1 max-w-[150px]"
                    disabled={isImported || isImporting}
                  >
                    <option value="">Auto-match</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>

                  {isImported ? (
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleImport(file)}
                      disabled={isImporting}
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      {isImporting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      {isImporting ? "Importing..." : "Import"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
