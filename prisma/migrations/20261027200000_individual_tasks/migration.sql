ALTER TABLE "tasks"
ADD COLUMN "contact_name" TEXT,
ADD COLUMN "contact_phone" TEXT,
ADD COLUMN "address" TEXT;

UPDATE "user" SET designation = 'Junior Service Engineer' WHERE designation = 'Junior Technician';
