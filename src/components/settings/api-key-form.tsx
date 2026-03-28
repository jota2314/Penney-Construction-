"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, AlertCircle, Key } from "lucide-react";
import { saveApiKey, getApiKeyStatus } from "@/lib/actions/settings";

export function ApiKeyForm() {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    getApiKeyStatus().then((status) => setHasKey(status));
  }, []);

  async function handleSave() {
    if (!key.trim()) return;
    setSaving(true);
    setResult(null);

    try {
      await saveApiKey(key.trim());
      setResult({ success: true, message: "API key saved!" });
      setHasKey(true);
      setKey("");
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          Status: {hasKey ? (
            <span className="text-emerald-400">Connected</span>
          ) : (
            <span className="text-red-400">Not configured</span>
          )}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="sk-ant-api03-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="font-mono text-sm"
        />
        <Button onClick={handleSave} disabled={saving || !key.trim()}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Get your key from{" "}
        <a href="https://console.anthropic.com" target="_blank" rel="noopener" className="text-blue-400 underline">
          console.anthropic.com
        </a>
      </p>
      {result && (
        <div className={`flex items-center gap-1.5 text-sm ${result.success ? "text-emerald-400" : "text-red-400"}`}>
          {result.success ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.message}
        </div>
      )}
    </div>
  );
}
