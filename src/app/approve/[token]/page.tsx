"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface COData {
  id: string;
  change_order_number: number;
  title: string;
  description: string | null;
  status: string;
  price_impact: number;
  client_signature: string | null;
  client_signed_at: string | null;
  project_name: string;
  project_number: string;
  project_address: string;
  contract_value: number;
  approved_cos_total: number;
}

const fmt = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

export default function ApproveChangeOrderPage() {
  const { token } = useParams();
  const [co, setCo] = useState<COData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/approve-change-order?token=${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setCo(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load"); setLoading(false); });
  }, [token]);

  async function handleApprove() {
    if (!signature.trim()) return;
    setSubmitting(true);
    const res = await fetch("/api/approve-change-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, signature: signature.trim() }),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    else setDone(true);
    setSubmitting(false);
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-gray-400 text-sm">Loading...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center p-8">
        <p className="text-red-600 font-medium">{error}</p>
      </div>
    </div>
  );

  if (!co) return null;

  const alreadySigned = co.client_signature || done;
  const sigName = co.client_signature || signature;
  const newTotal = co.contract_value + co.approved_cos_total + (co.status !== "approved" ? co.price_impact : 0);

  if (alreadySigned) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center py-16">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Change Order Approved</h1>
        <p className="text-gray-500 mb-1">CO #{co.change_order_number}: {co.title}</p>
        <p className="text-gray-500 mb-6">Signed by {sigName}</p>
        <div className="inline-block bg-gray-50 rounded-lg px-6 py-3 text-left">
          <p className="text-sm text-gray-500">Amount</p>
          <p className="text-xl font-bold text-gray-900">{fmt(co.price_impact)}</p>
        </div>
        <p className="text-xs text-gray-400 mt-6">
          {co.client_signed_at ? new Date(co.client_signed_at).toLocaleString() : "Just now"}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="bg-[#1a1a1a] rounded-t-lg px-6 py-5 text-center">
          <p className="text-xs text-gray-400 tracking-widest uppercase mb-1">Penney Construction Inc.</p>
          <h1 className="text-xl font-bold text-white">Change Order #{co.change_order_number}</h1>
        </div>

        <div className="bg-white rounded-b-lg shadow-sm border border-gray-200">

          {/* Project + date */}
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between text-sm">
            <div>
              <p className="text-gray-400 text-xs">Project</p>
              <p className="font-medium text-gray-900">{co.project_name}</p>
              <p className="text-gray-500 text-xs">{co.project_address}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-400 text-xs">Date</p>
              <p className="font-medium text-gray-900">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
            </div>
          </div>

          {/* Scope */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Description of Change</p>
            <h2 className="font-semibold text-gray-900 mb-2">{co.title}</h2>
            {co.description && (
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{co.description}</p>
            )}
          </div>

          {/* Amount */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex justify-between items-center">
              <p className="font-semibold text-gray-900">Change Order Amount</p>
              <p className="text-2xl font-bold text-gray-900">{fmt(co.price_impact)}</p>
            </div>
          </div>

          {/* Contract summary */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Contract Summary</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Original Contract</span>
                <span className="text-gray-900 font-medium">{fmt(co.contract_value)}</span>
              </div>
              {co.approved_cos_total > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Previous Changes</span>
                  <span className="text-gray-900 font-medium">+{fmt(co.approved_cos_total)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">This Change Order</span>
                <span className="text-gray-900 font-medium">+{fmt(co.price_impact)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-200">
                <span className="font-bold text-gray-900">New Contract Total</span>
                <span className="font-bold text-gray-900 text-lg">{fmt(newTotal)}</span>
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="px-6 py-6">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Authorization</p>
            <p className="text-xs text-gray-400 mb-4">
              By signing below, you authorize the work described above and agree to the adjusted contract amount.
            </p>
            <label className="text-sm font-medium text-gray-700 block mb-1">Your Full Name</label>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Type your full name"
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontSize: "24px", fontStyle: "italic" }}
              className="w-full px-4 py-4 border-b-2 border-gray-900 bg-transparent text-gray-900 focus:outline-none placeholder:text-gray-300 placeholder:text-base placeholder:not-italic"
              onKeyDown={(e) => e.key === "Enter" && handleApprove()}
            />
            <button
              onClick={handleApprove}
              disabled={submitting || !signature.trim()}
              className="w-full mt-4 py-3 rounded-lg font-semibold text-white bg-[#1a1a1a] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Processing..." : "Approve & Sign"}
            </button>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-50 rounded-b-lg text-center border-t border-gray-100">
            <p className="text-[11px] text-gray-400">Penney Construction Inc.  ·  North Shore, MA  ·  978-621-4387</p>
          </div>
        </div>
      </div>
    </div>
  );
}
