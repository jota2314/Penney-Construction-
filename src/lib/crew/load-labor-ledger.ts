import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateLabor } from './labor-ledger';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/auth/get-user';

// Never return a partial financial total when a page fails.
export async function financialRows<T>(factory: (from: number, to: number) => PromiseLike<{data: T[] | null; error: {message: string} | null}>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const {data, error} = await factory(from, from + 999);
    if (error || !data) throw new Error(error?.message ?? 'Financial records could not load.');
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function loadLaborLedger(db: SupabaseClient) {
  if (!await getUser()) throw new Error('Not authenticated');
  const [logs, employees, history, projects, phases] = await Promise.all([
    financialRows((f,t) => db.from('daily_logs').select('id,author_id,project_id,schedule_phase_id,estimate_line_item_id,started_at,ended_at,status,kind,clock_in_on_site,clock_in_distance_m').order('id').range(f,t)),
    financialRows((f,t) => db.from('employees').select('id,profile_id,first_name,last_name,hourly_rate').order('id').range(f,t)),
    financialRows((f,t) => db.from('employee_rate_changes').select('id,employee_id,effective_date,new_rate,previous_rate').order('effective_date').order('id').range(f,t)),
    financialRows((f,t) => db.from('projects').select('id,name,project_number,labor_cost_source,is_overhead').order('id').range(f,t)),
    financialRows((f,t) => db.from('schedule_phases').select('id,project_id,name,estimate_line_item_id').order('id').range(f,t)),
  ]);
  // Break overrides contain no pay rates. Read only overrides for authors of
  // logs already visible to this authenticated caller; PMs must cost the same
  // breaks as payroll without gaining payroll edit access.
  const authors = [...new Set(logs.map(l => l.author_id))];
  const admin = createAdminClient();
  const adjustments = authors.length ? await financialRows((f,t) => admin.from('payroll_adjustments')
    .select('id,profile_id,work_date,break_minutes').in('profile_id',authors).order('id').range(f,t)) : [];
  const phaseMap = new Map(phases.map(p => [p.id,p]));
  const resolved = logs.map(l => ({...l,project_id: l.project_id ?? phaseMap.get(l.schedule_phase_id)?.project_id ?? null}));
  const rows = calculateLabor(resolved, employees, history, adjustments, new Set(projects.filter(p=>p.labor_cost_source==='ledger').map(p=>p.id)));
  return { rows, employees, projects, phases };
}
