BEGIN;

INSERT INTO module_access_permissions (id, role_id, module_id, manage, "delete", updated_by, created_at)
SELECT
  (SELECT COALESCE(MAX(id), 0) + 1 FROM module_access_permissions),
  '5df890a0-aadf-433d-8b28-2f7067107c28',
  15,
  true,
  true,
  'd71bc6f4-c0ee-41f2-8da2-c8d44b3cf398',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM module_access_permissions
  WHERE role_id = '5df890a0-aadf-433d-8b28-2f7067107c28'
    AND module_id = 15
);

COMMIT;
