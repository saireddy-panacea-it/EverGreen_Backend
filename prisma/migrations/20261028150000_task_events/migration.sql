-- CreateTable
CREATE TABLE "task_event" (
    "id" SERIAL NOT NULL,
    "task_link" INTEGER NOT NULL,
    "event" VARCHAR(30) NOT NULL,
    "actor_link" INTEGER,
    "actor_name" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "target_link" INTEGER,
    "target_name" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_event_task_link_created_at_idx" ON "task_event"("task_link", "created_at");

-- AddForeignKey
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_task_link_fkey" FOREIGN KEY ("task_link") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_actor_link_fkey" FOREIGN KEY ("actor_link") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_target_link_fkey" FOREIGN KEY ("target_link") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill 1/4: "raised" for every task. Actor from the audit "created" row, else the user whose phone is tasks.created_by.
INSERT INTO "task_event" ("task_link", "event", "actor_link", "actor_name", "actor_role", "note", "created_at")
SELECT t."id", 'raised',
       COALESCE(a."actor_link", u."id"),
       COALESCE(a."actor_name", u."name", 'Unknown'),
       COALESCE(a."actor_role",
                CASE WHEN u."access_level" = 'technician' AND u."designation" = 'Senior Service Engineer' THEN 'senior_technician'
                     ELSE u."access_level"::text END,
                'unknown'),
       COALESCE(NULLIF(btrim(t."description"), ''), NULLIF(btrim(t."name"), '')),
       t."created_at"
FROM "tasks" t
LEFT JOIN "user" u ON u."phone" = t."created_by"
LEFT JOIN LATERAL (
    SELECT al."actor_link", al."actor_name", al."actor_role"
    FROM "audit_log" al
    WHERE al."entity" = 'task' AND al."action" = 'created' AND al."entity_id" = t."id"::text
    ORDER BY al."created_at", al."id"
    LIMIT 1
) a ON true;

-- Backfill 2/4: steps recorded in the audit log.
WITH status_rows AS (
    SELECT al."id",
           LAG(al."details") OVER (PARTITION BY al."entity_id" ORDER BY al."created_at", al."id") AS prev
    FROM "audit_log" al
    WHERE al."entity" = 'task' AND al."details" LIKE 'status=%'
), mapped AS (
    SELECT al.*,
           CASE
               WHEN al."action" = 'assigned' THEN 'assigned'
               WHEN al."action" = 'deleted' THEN 'deleted'
               WHEN al."details" = 'accepted by service engineer' THEN 'accepted'
               WHEN al."details" = 'status=in_progress' THEN
                   CASE WHEN s.prev = 'status=hold' THEN 'resumed'
                        WHEN s.prev IN ('status=completed', 'status=closed') THEN 'reopened'
                        ELSE 'started' END
               WHEN al."details" = 'status=hold' THEN 'hold'
               WHEN al."details" IN ('status=completed', 'service completed') THEN 'completed'
               WHEN al."details" IN ('status=closed', 'confirmed by client') THEN 'closed'
               WHEN al."details" = 'status=open' THEN 'reopened'
               WHEN al."details" LIKE 'approved%' THEN 'approved'
               WHEN al."details" LIKE 'rejected: %' THEN 'rejected'
               WHEN al."details" LIKE 'escalated: %' THEN 'escalated'
               WHEN al."details" = 'de-escalated' THEN 'deescalated'
               WHEN al."details" LIKE 'service engineer unassigned%' THEN 'unassigned'
           END AS event,
           CASE
               WHEN al."action" = 'assigned' THEN substring(al."details" FROM 'technician_link=([0-9]+)')::int
               WHEN al."details" LIKE 'service engineer unassigned%' THEN substring(al."details" FROM '\(was ([0-9]+)\)')::int
           END AS target_id
    FROM "audit_log" al
    LEFT JOIN status_rows s ON s."id" = al."id"
    WHERE al."entity" = 'task' AND al."entity_id" ~ '^[0-9]+$'
)
INSERT INTO "task_event" ("task_link", "event", "actor_link", "actor_name", "actor_role", "target_link", "target_name", "note", "created_at")
SELECT t."id", m.event, m."actor_link", m."actor_name", m."actor_role", tu."id", tu."name",
       CASE m.event
           WHEN 'approved' THEN NULLIF(substring(m."details" FROM '^approved: (.*)$'), '')
           WHEN 'rejected' THEN substring(m."details" FROM '^rejected: (.*)$')
           WHEN 'escalated' THEN substring(m."details" FROM '^escalated: (.*)$')
           WHEN 'deleted' THEN substring(m."details" FROM '^reason=(.*)$')
           WHEN 'hold' THEN h.note
       END,
       m."created_at"
FROM mapped m
JOIN "tasks" t ON t."id" = m."entity_id"::int
LEFT JOIN "user" tu ON tu."id" = m.target_id
LEFT JOIN LATERAL (
    SELECT concat_ws(' · ',
                     initcap(replace(hr."hold"::text, '_', ' ')),
                     CASE WHEN lower(btrim(hr."reason")) = lower(replace(hr."hold"::text, '_', ' ')) THEN NULL
                          ELSE NULLIF(btrim(hr."reason"), '') END,
                     'Spare part ' || NULLIF(btrim(hr."spare_part_number"), '')) AS note
    FROM "hold_reason" hr
    WHERE hr."task_link" = t."id"
      AND hr."created_at" BETWEEN m."created_at" - INTERVAL '2 minutes' AND m."created_at" + INTERVAL '2 minutes'
    ORDER BY abs(extract(epoch FROM hr."created_at" - m."created_at"))
    LIMIT 1
) h ON m.event = 'hold'
WHERE m.event IS NOT NULL;

-- Backfill 3/4: holds from hold_reason that the audit log missed (older tasks).
INSERT INTO "task_event" ("task_link", "event", "actor_link", "actor_name", "actor_role", "note", "created_at")
SELECT hr."task_link", 'hold', u."id", COALESCE(u."name", 'Unknown'),
       COALESCE(CASE WHEN u."access_level" = 'technician' AND u."designation" = 'Senior Service Engineer' THEN 'senior_technician'
                     ELSE u."access_level"::text END, 'unknown'),
       concat_ws(' · ',
                 initcap(replace(hr."hold"::text, '_', ' ')),
                 CASE WHEN lower(btrim(hr."reason")) = lower(replace(hr."hold"::text, '_', ' ')) THEN NULL
                          ELSE NULLIF(btrim(hr."reason"), '') END,
                 'Spare part ' || NULLIF(btrim(hr."spare_part_number"), '')),
       hr."created_at"
FROM "hold_reason" hr
LEFT JOIN "user" u ON u."phone" = hr."created_by"
WHERE NOT EXISTS (
    SELECT 1 FROM "task_event" e
    WHERE e."task_link" = hr."task_link" AND e."event" = 'hold'
      AND abs(extract(epoch FROM e."created_at" - hr."created_at")) <= 120
);

-- Backfill 4/4: steps known only from task timestamps / the latest assignment row (older tasks).
WITH latest AS (
    SELECT DISTINCT ON (tu."task_link") tu.*
    FROM "task_user" tu
    ORDER BY tu."task_link", tu."id" DESC
), facts AS (
    SELECT t."id" AS task_id, l."status"::text AS status, l."updated_at" AS row_at,
           tech."id" AS tech_id, tech."name" AS tech_name,
           CASE WHEN tech."designation" = 'Senior Service Engineer' THEN 'senior_technician' ELSE 'technician' END AS tech_role,
           upd."id" AS upd_id, upd."name" AS upd_name,
           CASE WHEN upd."access_level" = 'technician' AND upd."designation" = 'Senior Service Engineer' THEN 'senior_technician'
                ELSE upd."access_level"::text END AS upd_role,
           t."assigned_at", t."accepted_at", t."started_at", t."resolved_at", t."closed_at", t."created_at"
    FROM "tasks" t
    JOIN latest l ON l."task_link" = t."id"
    LEFT JOIN "user" tech ON tech."id" = l."technician_link"
    LEFT JOIN "user" upd ON upd."phone" = l."updated_by"
), candidates AS (
    SELECT task_id, 'assigned' AS event, NULL::int AS actor_id, 'Unknown' AS actor_name, 'unknown' AS actor_role,
           tech_id AS target_id, tech_name AS target_name, COALESCE("assigned_at", "created_at") AS at
    FROM facts WHERE tech_id IS NOT NULL
    UNION ALL
    SELECT task_id, 'accepted', tech_id, tech_name, tech_role, NULL, NULL, "accepted_at"
    FROM facts WHERE "accepted_at" IS NOT NULL AND tech_id IS NOT NULL
    UNION ALL
    SELECT task_id, 'started', tech_id, COALESCE(tech_name, 'Unknown'), COALESCE(tech_role, 'unknown'), NULL, NULL, "started_at"
    FROM facts WHERE "started_at" IS NOT NULL
    UNION ALL
    SELECT task_id, 'completed', tech_id, COALESCE(tech_name, 'Unknown'), COALESCE(tech_role, 'unknown'), NULL, NULL, "resolved_at"
    FROM facts WHERE "resolved_at" IS NOT NULL
    UNION ALL
    SELECT task_id, 'closed',
           CASE WHEN status = 'closed' THEN upd_id END,
           COALESCE(CASE WHEN status = 'closed' THEN upd_name END, 'Unknown'),
           COALESCE(CASE WHEN status = 'closed' THEN upd_role END, 'unknown'),
           NULL, NULL, COALESCE("closed_at", row_at)
    FROM facts WHERE "closed_at" IS NOT NULL OR status = 'closed'
)
INSERT INTO "task_event" ("task_link", "event", "actor_link", "actor_name", "actor_role", "target_link", "target_name", "created_at")
SELECT c.task_id, c.event, c.actor_id, c.actor_name, c.actor_role, c.target_id, c.target_name, c.at
FROM candidates c
WHERE NOT EXISTS (
    SELECT 1 FROM "task_event" e
    WHERE e."task_link" = c.task_id
      AND (e."event" = c.event OR (c.event = 'assigned' AND e."event" = 'reassigned'))
);
