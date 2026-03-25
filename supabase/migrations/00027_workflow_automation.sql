-- ============================================================
-- Workflow Automation Tables
-- Tracks the full construction project lifecycle:
-- Lead → Walkthrough → Estimator → Client Approval → Admin/Deposit → Job Package → Project Manager
-- ============================================================

-- Workflow stage enum
create type workflow_stage as enum (
  'lead_intake',
  'walkthrough',
  'estimating',
  'client_review',
  'admin_deposit',
  'job_package',
  'project_management'
);

-- Workflow instance status
create type workflow_status as enum (
  'active',
  'paused',
  'completed',
  'cancelled'
);

-- Workflow action types for the log
create type workflow_action_type as enum (
  'stage_advanced',
  'email_sent',
  'folder_created',
  'meeting_created',
  'estimate_sent',
  'client_approved',
  'client_rejected',
  'deposit_received',
  'contract_sent',
  'job_package_created',
  'assigned_to_pm',
  'note_added'
);

-- ── Main workflow instances table ──────────────────────────
create table workflow_instances (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  estimate_id uuid references estimates(id) on delete set null,

  -- Current state
  current_stage workflow_stage not null default 'lead_intake',
  status workflow_status not null default 'active',

  -- Project info captured at lead intake
  project_name text not null,
  client_name text not null,
  client_email text,
  client_phone text,
  project_address text,
  project_city text,
  project_state text,
  project_zip text,
  project_type text,
  project_description text,

  -- Google integration references
  google_drive_folder_id text,
  google_drive_folder_url text,
  google_calendar_event_id text,
  google_sheet_id text,
  google_sheet_url text,

  -- Key personnel
  assigned_estimator uuid references profiles(id) on delete set null,
  assigned_pm uuid references profiles(id) on delete set null,
  assigned_admin uuid references profiles(id) on delete set null,

  -- Financial
  estimate_amount numeric(12,2),
  deposit_amount numeric(12,2),
  contract_signed_at timestamptz,
  deposit_received_at timestamptz,

  -- Walkthrough
  walkthrough_date timestamptz,
  walkthrough_id uuid references walkthroughs(id) on delete set null,

  -- Timestamps for each stage
  lead_intake_at timestamptz default now(),
  walkthrough_completed_at timestamptz,
  estimate_sent_at timestamptz,
  client_approved_at timestamptz,
  deposit_received_confirmed_at timestamptz,
  job_package_created_at timestamptz,
  assigned_to_pm_at timestamptz,
  completed_at timestamptz,

  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Workflow action log ──────────────────────────────────────
create table workflow_actions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflow_instances(id) on delete cascade,
  action_type workflow_action_type not null,
  stage workflow_stage not null,
  description text not null,
  metadata jsonb default '{}',
  performed_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ── Email templates for workflow stages ──────────────────────
create table workflow_email_templates (
  id uuid primary key default gen_random_uuid(),
  stage workflow_stage not null,
  template_name text not null,
  subject text not null,
  body text not null,
  recipient_type text not null default 'client', -- client, estimator, admin, pm
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Indexes ──────────────────────────────────────────────────
create index idx_workflow_instances_lead on workflow_instances(lead_id);
create index idx_workflow_instances_project on workflow_instances(project_id);
create index idx_workflow_instances_stage on workflow_instances(current_stage);
create index idx_workflow_instances_status on workflow_instances(status);
create index idx_workflow_actions_workflow on workflow_actions(workflow_id);
create index idx_workflow_actions_type on workflow_actions(action_type);

-- ── RLS Policies ─────────────────────────────────────────────
alter table workflow_instances enable row level security;
alter table workflow_actions enable row level security;
alter table workflow_email_templates enable row level security;

create policy "Authenticated users can view workflows"
  on workflow_instances for select
  to authenticated
  using (true);

create policy "Authenticated users can insert workflows"
  on workflow_instances for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update workflows"
  on workflow_instances for update
  to authenticated
  using (true);

create policy "Authenticated users can view workflow actions"
  on workflow_actions for select
  to authenticated
  using (true);

create policy "Authenticated users can insert workflow actions"
  on workflow_actions for insert
  to authenticated
  with check (true);

create policy "Authenticated users can view email templates"
  on workflow_email_templates for select
  to authenticated
  using (true);

create policy "Authenticated users can manage email templates"
  on workflow_email_templates for all
  to authenticated
  using (true);

-- ── Seed default email templates ─────────────────────────────
insert into workflow_email_templates (stage, template_name, subject, body, recipient_type) values
-- Lead Intake
('lead_intake', 'New Lead Welcome', 'Welcome to Penney Construction - {{project_name}}',
 'Hi {{client_name}},

Thank you for reaching out to Penney Construction! We''re excited to discuss your {{project_type}} project.

We''ve received your project details and our team is getting things set up. Here''s what happens next:

1. We''ll schedule a walkthrough at your property
2. Our estimator will prepare a detailed estimate
3. You''ll receive a proposal for review

A team member will be in touch shortly to schedule your walkthrough.

Best regards,
Penney Construction Team', 'client'),

('lead_intake', 'New Lead Assignment', 'New Lead: {{client_name}} - {{project_type}}',
 'A new lead has been entered into the workflow:

Client: {{client_name}}
Project: {{project_name}}
Type: {{project_type}}
Address: {{project_address}}
Description: {{project_description}}

A Google Drive folder has been created and a walkthrough needs to be scheduled.

Drive Folder: {{drive_folder_url}}', 'estimator'),

-- Walkthrough
('walkthrough', 'Walkthrough Scheduled', 'Walkthrough Scheduled - {{project_name}}',
 'Hi {{client_name}},

Your walkthrough has been scheduled for {{walkthrough_date}}.

Address: {{project_address}}

Our estimator will visit your property to assess the scope of work and take detailed notes. Please ensure access to all areas related to the project.

If you need to reschedule, please reply to this email.

Best regards,
Penney Construction Team', 'client'),

-- Estimating
('estimating', 'Estimate Ready for Review', 'Your Estimate is Ready - {{project_name}}',
 'Hi {{client_name}},

Great news! Your estimate for {{project_name}} is ready for review.

Estimate Amount: ${{estimate_amount}}

You can review the detailed breakdown in the attached estimate sheet:
{{sheet_url}}

Please review and let us know if you have any questions or would like to discuss any items.

Best regards,
Penney Construction Team', 'client'),

-- Client Approval
('client_review', 'Client Approved - Admin Notification', 'Client Approved: {{project_name}} - Deposit Required',
 'The client has approved the estimate for {{project_name}}.

Client: {{client_name}}
Approved Amount: ${{estimate_amount}}

Next steps:
1. Prepare and send the contract
2. Collect the deposit
3. Once deposit is received, notify the estimator to create the job package

Drive Folder: {{drive_folder_url}}', 'admin'),

-- Admin/Deposit
('admin_deposit', 'Contract & Deposit Request', 'Contract Ready - {{project_name}}',
 'Hi {{client_name}},

Thank you for approving the estimate for {{project_name}}!

Please find the contract attached. To proceed, we''ll need:
1. Signed contract
2. Deposit payment

Once we receive your deposit, our team will begin preparing the detailed job package and project schedule.

Best regards,
Penney Construction Team', 'client'),

('admin_deposit', 'Deposit Received - Job Package Request', 'Deposit Received: {{project_name}} - Create Job Package',
 'The deposit has been received for {{project_name}}.

Client: {{client_name}}
Deposit Amount: ${{deposit_amount}}
Contract Amount: ${{estimate_amount}}

Please create the job package for this project and hand it off to the project manager.

Drive Folder: {{drive_folder_url}}', 'estimator'),

-- Job Package
('job_package', 'Job Package Ready - PM Assignment', 'Job Package Ready: {{project_name}}',
 'A job package has been created for {{project_name}} and is ready for your review.

Client: {{client_name}}
Project Type: {{project_type}}
Address: {{project_address}}
Contract Amount: ${{estimate_amount}}

The job package and all project documents are in the Drive folder:
{{drive_folder_url}}

Please review and begin project scheduling.

Best regards,
Penney Construction Team', 'pm'),

-- Project Management
('project_management', 'Project Kickoff', 'Project Kickoff - {{project_name}}',
 'Hi {{client_name}},

We''re thrilled to let you know that your project {{project_name}} is officially underway!

Your Project Manager will be your main point of contact going forward. They''ll be reaching out to discuss the project timeline and next steps.

We''re excited to bring your vision to life!

Best regards,
Penney Construction Team', 'client');
