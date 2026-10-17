export type InspectionStatus = "pending" | "passed" | "failed";
export interface ScheduleInspection {
  id: string;
  project_id: string;
  name: string;
  status: InspectionStatus;
  schedule_phase_id: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  notes: string | null;
  is_final: boolean;
  updated_at: string;
}
export interface InspectionMilestone {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  actual_completed_at: string | null;
}
export interface InspectionHistory {
  id: string;
  inspection_id: string;
  created_at: string;
  source: string;
  before_record: ScheduleInspection | null;
  after_record: ScheduleInspection | null;
}
