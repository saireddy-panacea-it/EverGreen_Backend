import { PrismaClient } from "@prisma/client";

/** Steps recorded on a ticket's timeline. Keep in sync with the app's `TaskEventType`. */
export const TASK_EVENT_TYPES = [
  "raised",
  "assigned",
  "reassigned",
  "unassigned",
  "accepted",
  "approved",
  "rejected",
  "started",
  "hold",
  "resumed",
  "completed",
  "closed",
  "reopened",
  "escalated",
  "deescalated",
  "deleted",
] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export type TaskEventEntry = {
  taskId: number;
  event: TaskEventType;
  actorLink?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  targetLink?: number | null;
  targetName?: string | null;
  note?: string | null;
};

export type TaskEventRow = {
  event: string;
  actor_name: string;
  target_name?: string | null;
  note?: string | null;
  created_at: Date;
};

/** Timeline writes must never fail the request that triggered them. */
export async function writeTaskEvent(client: PrismaClient, entry: TaskEventEntry): Promise<void> {
  try {
    await client.task_event.create({
      data: {
        task_link: entry.taskId,
        event: entry.event,
        actor_link: entry.actorLink ?? null,
        actor_name: entry.actorName || "Unknown",
        actor_role: entry.actorRole || "unknown",
        target_link: entry.targetLink ?? null,
        target_name: entry.targetName ?? null,
        note: entry.note?.trim() ? entry.note.trim() : null,
      },
    });
  } catch (error) {
    console.error("task event write failed", error?.message || error);
  }
}

/** Timeline step implied by a status change, or null when nothing changed. */
export function taskEventForStatus(previous: string | null | undefined, next: string | null | undefined): TaskEventType | null {
  if (!next || previous === next) return null;
  switch (next) {
    case "in_progress":
      if (previous === "hold") return "resumed";
      if (previous === "completed" || previous === "closed") return "reopened";
      return "started";
    case "hold":
      return "hold";
    case "completed":
      return "completed";
    case "closed":
      return "closed";
    case "open":
      return "reopened";
    default:
      return null;
  }
}

/** "spare_required" -> "Spare Required" (same as the migration backfill's initcap). */
export function holdLabel(hold: string | null | undefined): string {
  return String(hold ?? "")
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Hold note: type, reason and spare part, e.g. "Spare Required · CAM switch blown · Spare part SP-12". */
export function holdNote(hold: { hold_reason?: string; hold?: string; reason?: string; spare_part_number?: string } | null | undefined): string | null {
  if (!hold) return null;
  const label = holdLabel(hold.hold_reason ?? hold.hold);
  const reason = hold.reason?.trim();
  const parts = [
    label,
    reason && reason.toLowerCase() !== label.toLowerCase() ? reason : null,
    hold.spare_part_number?.trim() ? `Spare part ${hold.spare_part_number.trim()}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The few steps a service report shows: who raised it, who it was assigned
 * to / accepted by, when work started, and who completed and closed it.
 */
export function reportTimeline(events: TaskEventRow[] | null | undefined): Array<{ at: Date; title: string; detail: string }> {
  const sorted = [...(events ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const first = (types: string[]) => sorted.find((e) => types.includes(e.event));
  const last = (types: string[]) => [...sorted].reverse().find((e) => types.includes(e.event));
  const rows: Array<{ at: Date; title: string; detail: string }> = [];
  const raised = first(["raised"]);
  if (raised) rows.push({ at: raised.created_at, title: "Raised", detail: `By ${raised.actor_name}` });
  const assigned = last(["assigned", "reassigned"]);
  if (assigned) {
    rows.push({
      at: assigned.created_at,
      title: "Assigned",
      detail: `To ${assigned.target_name || "service engineer"} by ${assigned.actor_name}`,
    });
  }
  const accepted = last(["accepted"]);
  if (accepted) rows.push({ at: accepted.created_at, title: "Accepted", detail: `By ${accepted.actor_name}` });
  const started = first(["started"]);
  if (started) rows.push({ at: started.created_at, title: "Work started", detail: `By ${started.actor_name}` });
  const completed = last(["completed"]);
  if (completed) rows.push({ at: completed.created_at, title: "Completed", detail: `By ${completed.actor_name}` });
  const closed = last(["closed", "rejected"]);
  if (closed) {
    rows.push({
      at: closed.created_at,
      title: closed.event === "rejected" ? "Rejected" : "Closed",
      detail: `By ${closed.actor_name}`,
    });
  }
  return rows;
}
