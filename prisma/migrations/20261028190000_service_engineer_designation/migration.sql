-- "Junior" is dropped: engineers are either Senior Service Engineer or Service Engineer.
UPDATE "user" SET "designation" = 'Service Engineer'
WHERE "designation" IN ('Junior Service Engineer', 'Junior Technician');
