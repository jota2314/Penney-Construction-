import { z } from "zod";

export function parseSplitJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1].trim() : text.trim());
}

export const splitAnalysisSchema = z.object({
  explanation: z.string().max(4000),
  warnings: z.array(z.string().max(1000)).max(20),
  pieces: z.array(z.object({
    project_id: z.string().uuid().nullable(),
    line_item_id: z.string().uuid().nullable().optional(),
    amount: z.number().finite(),
    note: z.string().min(1).max(2000),
  })).max(40),
});

export function validateSplitAmounts(amount: number, pieces: { amount: number }[]) {
  if (!pieces.length) return;
  if (!amount || pieces.some(p => !Number.isFinite(p.amount) || !p.amount ||
    Math.sign(p.amount) !== Math.sign(amount) || Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.00001)) {
    throw new Error("The suggested amounts are invalid. Enter the split manually or try again.");
  }
  if (pieces.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) !== Math.round(amount * 100)) {
    throw new Error("The receipt amounts do not balance with this transaction. Review the receipt before splitting.");
  }
}
