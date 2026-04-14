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
  cost_impact: number;
  client_signature: string | null;
  client_signed_at: string | null;
  project_name: string;
  project_number: string;
  project_address: string;
  contract_value: number;
  approved_cos_total: number;
}

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

  const fmt = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Loading...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
        <p className="text-red-500 font-medium">{error}</p>
      </div>
    </div>
  );

  if (!co) return null;

  // Already signed
  if (co.client_signature || done) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg w-full text-center">
        <div className="text-5xl mb-4">&#10003;</div>
        <h1 className="text-2xl font-bold text-green-600 mb-2">Change Order Approved</h1>
        <p className="text-gray-600 mb-4">
          CO #{co.change_order_number}: {co.title} has been approved
          {co.client_signature ? ` by ${co.client_signature}` : done ? ` by ${signature}` : ""}.
        </p>
        <p className="text-sm text-gray-400">
          {co.client_signed_at ? `Signed: ${new Date(co.client_signed_at).toLocaleString()}` : "Just now"}
        </p>
        <div className="mt-6 p-4 bg-green-50 rounded-lg">
          <p className="text-sm font-medium text-green-800">Amount: {fmt(co.price_impact)}</p>
          <p className="text-sm text-green-700">New contract total: {fmt(co.contract_value + co.approved_cos_total + (co.status !== "approved" ? co.price_impact : 0))}</p>
        </div>
      </div>
    </div>
  );

  const newTotal = co.contract_value + co.approved_cos_total + co.price_impact;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-[#434343] rounded-t-xl p-6 text-white text-center">
          <h1 className="text-xl font-bold">CHANGE ORDER #{co.change_order_number}</h1>
          <p className="text-sm mt-1 opacity-80">{co.project_name}  |  {co.project_address}</p>
        </div>

        <div className="bg-white rounded-b-xl shadow-lg">
          {/* Project info */}
          <div className="p-6 border-b">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-medium text-gray-500">Project:</span> <span className="font-semibold">{co.project_number} — {co.project_name}</span></div>
              <div><span className="font-medium text-gray-500">Date:</span> {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            </div>
          </div>

          {/* Change description */}
          <div className="p-6 border-b">
            <h2 className="font-bold text-lg mb-3">{co.title}</h2>
            {co.description && (
              <div className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 rounded-lg p-4">
                {co.description}
              </div>
            )}
          </div>

          {/* Amount */}
          <div className="p-6 border-b">
            <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
              <span className="font-bold text-lg">Change Order Amount</span>
              <span className="font-bold text-2xl text-green-700">{fmt(co.price_impact)}</span>
            </div>
          </div>

          {/* Contract summary */}
          <div className="p-6 border-b">
            <h3 className="font-semibold text-sm text-gray-500 mb-3">CONTRACT SUMMARY</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Original Contract</span><span className="font-medium">{fmt(co.contract_value)}</span></div>
              {co.approved_cos_total > 0 && (
                <div className="flex justify-between"><span>Previous Approved Changes</span><span className="font-medium">+{fmt(co.approved_cos_total)}</span></div>
              )}
              <div className="flex justify-between text-orange-600"><span>This Change Order</span><span className="font-medium">+{fmt(co.price_impact)}</span></div>
              <div className="flex justify-between pt-2 border-t font-bold text-lg">
                <span>New Contract Total</span>
                <span className="text-green-700">{fmt(newTotal)}</span>
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="p-6">
            <h3 className="font-semibold text-sm text-gray-500 mb-1">AUTHORIZATION</h3>
            <p className="text-xs text-gray-400 mb-4">
              By typing your name below, you authorize the work described above and agree to the adjusted contract amount.
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Full Name (as signature)</label>
                <input
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Type your full name to sign"
                  className="w-full mt-1 px-4 py-3 border-2 border-gray-300 rounded-lg text-lg font-serif italic focus:border-green-500 focus:ring-green-500 outline-none"
                />
              </div>
              <button
                onClick={handleApprove}
                disabled={submitting || !signature.trim()}
                className="w-full py-3 rounded-lg font-bold text-white text-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Processing..." : "Approve & Sign"}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 rounded-b-xl text-center">
            <p className="text-xs text-gray-400">Penney Construction Inc.  ·  North Shore, MA  ·  penneyconstructioninc.com  ·  978-621-4387</p>
          </div>
        </div>
      </div>
    </div>
  );
}
