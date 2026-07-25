"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ScheduleRow {
  label: string;
  amount: number;
}

interface ContractData {
  project_id: string;
  project_name: string;
  project_number: string;
  project_address: string;
  client_name: string;
  scope_of_work: string;
  contract_total: number;
  schedule: ScheduleRow[];
  client_signature: string | null;
  client_signed_at: string | null;
  countersigned_at: string | null;
  countersigned_signature: string | null;
}

const fmt = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

export default function SignContractPage() {
  const { token } = useParams();
  const [contract, setContract] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signature, setSignature] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sign-contract?token=${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setContract(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load"); setLoading(false); });
  }, [token]);

  async function handleSign() {
    if (!signature.trim() || !agreed) return;
    setSubmitting(true);
    const res = await fetch("/api/sign-contract", {
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

  if (!contract) return null;

  const alreadySigned = !!contract.client_signature || done;
  const sigName = contract.client_signature || signature;

  if (alreadySigned) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center py-16">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Contract Signed</h1>
        <p className="text-gray-500 mb-1">{contract.project_name}</p>
        <p className="text-gray-500 mb-6">Signed by {sigName}</p>
        <div className="inline-block bg-gray-50 rounded-lg px-6 py-3 text-left">
          <p className="text-sm text-gray-500">Contract Price</p>
          <p className="text-xl font-bold text-gray-900">{fmt(contract.contract_total)}</p>
        </div>
        <p className="text-sm text-gray-500 mt-6 px-6">
          {contract.countersigned_at
            ? "Penney Construction has countersigned. A fully executed copy is on its way to you."
            : "Penney Construction will countersign and email you a fully executed copy."}
        </p>
        <p className="text-xs text-gray-400 mt-4">
          {contract.client_signed_at ? new Date(contract.client_signed_at).toLocaleString() : "Just now"}
        </p>
      </div>
    </div>
  );

  const scheduleTotal = contract.schedule.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="bg-[#1a1a1a] rounded-t-lg px-6 py-5 text-center">
          <p className="text-xs text-gray-400 tracking-widest uppercase mb-1">Penney Construction Inc.</p>
          <h1 className="text-xl font-bold text-white">Construction Contract</h1>
          {contract.project_number && (
            <p className="text-xs text-gray-400 mt-1">{contract.project_number}</p>
          )}
        </div>

        <div className="bg-white rounded-b-lg shadow-sm border border-gray-200">

          {/* Parties + project */}
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between text-sm">
            <div>
              <p className="text-gray-400 text-xs">Project</p>
              <p className="font-medium text-gray-900">{contract.project_name}</p>
              <p className="text-gray-500 text-xs">{contract.project_address}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-400 text-xs">Owner</p>
              <p className="font-medium text-gray-900">{contract.client_name}</p>
              <p className="text-gray-500 text-xs">
                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
          </div>

          {/* Price */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex justify-between items-center">
              <p className="font-semibold text-gray-900">Contract Price</p>
              <p className="text-2xl font-bold text-gray-900">{fmt(contract.contract_total)}</p>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Fixed price. Changes to the work are handled by written change order.
            </p>
          </div>

          {/* Payment schedule */}
          {contract.schedule.length > 0 && (
            <div className="px-6 py-5 border-b border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Payment Schedule</p>
              <div className="space-y-2 text-sm">
                {contract.schedule.map((row, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <span className="text-gray-600">{row.label}</span>
                    <span className="text-gray-900 font-medium whitespace-nowrap">{fmt(row.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-gray-200">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="font-bold text-gray-900">{fmt(scheduleTotal)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Scope */}
          {contract.scope_of_work && (
            <div className="px-6 py-5 border-b border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Scope of Work</p>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {contract.scope_of_work}
              </p>
            </div>
          )}

          {/* Signature */}
          <div className="px-6 py-6">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Signature</p>
            <p className="text-xs text-gray-400 mb-4">
              The full terms are in the contract PDF attached to the email that brought you here.
              Please read it before signing. You may cancel this contract without penalty within
              three (3) business days after signing (M.G.L. c.142A).
            </p>

            <label className="flex items-start gap-2 mb-4 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-gray-900"
              />
              <span>
                I have read the attached contract and agree to its terms, the scope of work, and the
                contract price of {fmt(contract.contract_total)}.
              </span>
            </label>

            <label className="text-sm font-medium text-gray-700 block mb-1">Your Full Name</label>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Type your full name"
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontSize: "24px", fontStyle: "italic" }}
              className="w-full px-4 py-4 border-b-2 border-gray-900 bg-transparent text-gray-900 focus:outline-none placeholder:text-gray-300 placeholder:text-base placeholder:not-italic"
              onKeyDown={(e) => e.key === "Enter" && handleSign()}
            />
            <button
              onClick={handleSign}
              disabled={submitting || !signature.trim() || !agreed}
              className="w-full mt-4 py-3 rounded-lg font-semibold text-white bg-[#1a1a1a] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Processing..." : "Sign Contract"}
            </button>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-50 rounded-b-lg text-center border-t border-gray-100">
            <p className="text-[11px] text-gray-400">
              Penney Construction Inc.  ·  HIC Reg #198443  ·  CSL CS-099765  ·  978-621-4387
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
