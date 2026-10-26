CREATE TYPE "task_priority" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "approval_state" AS ENUM ('requested', 'approved', 'assigned', 'in_service', 'completed', 'confirmed', 'rejected');

CREATE TYPE "equipment_status" AS ENUM ('operational', 'under_maintenance', 'faulty', 'retired');

CREATE TYPE "pm_frequency" AS ENUM ('monthly', 'quarterly', 'half_yearly', 'yearly');

CREATE TYPE "audit_action" AS ENUM ('created', 'updated', 'deleted', 'logged_in', 'logged_out', 'assigned');

CREATE TYPE "audit_entity" AS ENUM ('user', 'task', 'amc', 'equipment', 'auth');

ALTER TABLE "user"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "bio" TEXT,
ADD COLUMN "date_of_birth" TIMESTAMP(3),
ADD COLUMN "avatar_url" TEXT;

ALTER TABLE "tasks"
ADD COLUMN "priority" "task_priority" NOT NULL DEFAULT 'medium',
ADD COLUMN "approval" "approval_state" NOT NULL DEFAULT 'requested',
ADD COLUMN "manager_link" INTEGER,
ADD COLUMN "due_date" TIMESTAMP(3),
ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "escalation_reason" TEXT,
ADD COLUMN "assigned_at" TIMESTAMP(3),
ADD COLUMN "accepted_at" TIMESTAMP(3),
ADD COLUMN "started_at" TIMESTAMP(3),
ADD COLUMN "resolved_at" TIMESTAMP(3),
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "resolution_notes" TEXT,
ADD COLUMN "rejection_reason" TEXT;

ALTER TABLE "equipment"
ADD COLUMN "status" "equipment_status" NOT NULL DEFAULT 'operational',
ADD COLUMN "type" TEXT,
ADD COLUMN "installed_at" TIMESTAMP(3),
ADD COLUMN "verified_at" TIMESTAMP(3),
ADD COLUMN "verified_by" INTEGER;

CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "actor_link" INTEGER,
    "actor_name" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" "audit_action" NOT NULL,
    "entity" "audit_entity" NOT NULL,
    "entity_id" TEXT,
    "entity_name" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pm_schedule" (
    "id" SERIAL NOT NULL,
    "equipment_link" INTEGER NOT NULL,
    "frequency" "pm_frequency" NOT NULL,
    "next_due" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "pm_schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pm_generated_task" (
    "id" SERIAL NOT NULL,
    "schedule_link" INTEGER NOT NULL,
    "task_link" INTEGER,
    "due_date" TIMESTAMP(3) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_generated_task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

CREATE INDEX "audit_log_actor_link_idx" ON "audit_log"("actor_link");

CREATE INDEX "pm_schedule_equipment_link_idx" ON "pm_schedule"("equipment_link");

CREATE UNIQUE INDEX "pm_generated_task_schedule_link_due_date_key" ON "pm_generated_task"("schedule_link", "due_date");

ALTER TABLE "equipment" ADD CONSTRAINT "equipment_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_manager_link_fkey" FOREIGN KEY ("manager_link") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_link_fkey" FOREIGN KEY ("actor_link") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pm_schedule" ADD CONSTRAINT "pm_schedule_equipment_link_fkey" FOREIGN KEY ("equipment_link") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pm_generated_task" ADD CONSTRAINT "pm_generated_task_schedule_link_fkey" FOREIGN KEY ("schedule_link") REFERENCES "pm_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pm_generated_task" ADD CONSTRAINT "pm_generated_task_task_link_fkey" FOREIGN KEY ("task_link") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill approval from each task's latest task_user row (highest id).
WITH latest AS (
    SELECT DISTINCT ON ("task_link") "task_link", "status", "technician_link", "updated_at"
    FROM "task_user"
    ORDER BY "task_link", "id" DESC
)
UPDATE "tasks" t
SET "approval" = CASE
        WHEN l."status" = 'open' AND l."technician_link" IS NULL THEN 'approved'::"approval_state"
        WHEN l."status" = 'open' THEN 'assigned'::"approval_state"
        WHEN l."status" IN ('hold', 'in_progress') THEN 'in_service'::"approval_state"
        WHEN l."status" = 'completed' THEN 'completed'::"approval_state"
        WHEN l."status" = 'closed' THEN 'confirmed'::"approval_state"
        ELSE t."approval"
    END,
    "closed_at" = CASE WHEN l."status" = 'closed' THEN l."updated_at" ELSE t."closed_at" END
FROM latest l
WHERE l."task_link" = t."id";

-- Tasks without any task_user row pre-date the approval flow; treat them as approved.
UPDATE "tasks" t
SET "approval" = 'approved'
WHERE NOT EXISTS (SELECT 1 FROM "task_user" tu WHERE tu."task_link" = t."id");

UPDATE "tasks"
SET "priority" = 'high'
WHERE "call_type" = 'breakdown';
