ALTER TYPE "audit_entity" ADD VALUE 'issue_type';

CREATE TABLE "issue_type" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "call_type" "call_type",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "issue_type_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "issue_type_name_key" ON "issue_type"("name");

INSERT INTO "issue_type" ("name", "call_type", "created_by", "updated_by") VALUES
    ('AMC / PM', 'amc_preventive_maintenance', 'migration', 'migration'),
    ('Breakdown', 'breakdown', 'migration', 'migration'),
    ('Service', 'service', 'migration', 'migration');

ALTER TABLE "tasks"
ADD COLUMN "location" TEXT,
ADD COLUMN "issue_type_link" INTEGER,
ADD COLUMN "deleted_at" TIMESTAMP(3),
ADD COLUMN "deleted_by" INTEGER,
ADD COLUMN "delete_reason" TEXT;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_issue_type_link_fkey" FOREIGN KEY ("issue_type_link") REFERENCES "issue_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "tasks" t SET "issue_type_link" = it."id"
FROM "issue_type" it
WHERE it."call_type" = t."call_type";

-- One active task per equipment replaces the name/description/call_type uniqueness.
DROP INDEX IF EXISTS "tasks_equipment_link_name_description_call_type_key";
