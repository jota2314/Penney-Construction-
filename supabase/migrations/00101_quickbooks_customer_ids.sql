-- Link app customers/projects to QuickBooks Customer / Sub-customer (Job) records
ALTER TABLE customers ADD COLUMN IF NOT EXISTS quickbooks_customer_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS quickbooks_customer_id text;
COMMENT ON COLUMN customers.quickbooks_customer_id IS 'QuickBooks Customer.Id for this client';
COMMENT ON COLUMN projects.quickbooks_customer_id IS 'QuickBooks sub-customer (Job) Id for this project';
