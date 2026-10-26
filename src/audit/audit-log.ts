import { PrismaClient, audit_action, audit_entity } from "@prisma/client";

export type AuditEntry = {
  actorLink?: number | null;
  actorName: string;
  actorRole: string;
  action: audit_action;
  entity: audit_entity;
  entityId?: string | number | null;
  entityName: string;
  details?: string | null;
};

/** Audit writes must never fail the request that triggered them. */
export async function writeAuditLog(client: PrismaClient, entry: AuditEntry): Promise<void> {
  try {
    await client.audit_log.create({
      data: {
        actor_link: entry.actorLink ?? null,
        actor_name: entry.actorName || "Unknown",
        actor_role: entry.actorRole || "unknown",
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId != null ? String(entry.entityId) : null,
        entity_name: entry.entityName || "-",
        details: entry.details ?? null,
      },
    });
  } catch (error) {
    console.error("audit log write failed", error?.message || error);
  }
}
