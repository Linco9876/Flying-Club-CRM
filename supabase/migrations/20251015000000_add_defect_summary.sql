-- Adds a short summary field for defects so the UI can display a concise overview
ALTER TABLE defects
  ADD COLUMN IF NOT EXISTS summary text;

COMMENT ON COLUMN defects.summary IS 'Short summary of the defect used for dashboard displays';