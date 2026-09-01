import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, access_level, status } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { FirebaseService } from '../firebase/firebase.service';

const prisma = new PrismaClient();

export const ROLE = {
  ADMIN: access_level.eg_super_admin,
  MANAGER: access_level.eg_admin,
  TECHNICIAN: access_level.technician,
  AMC_MANAGER: access_level.client_admin,
  CLIENT: access_level.client,
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly firebaseService: FirebaseService) {}

  private asStringData(data: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(data || {})) {
      out[key] = value == null ? '' : String(value);
    }
    return out;
  }

  taskPayload(
    task: {
      id?: number;
      name?: string | null;
      description?: string | null;
      equipment?: {
        eg_serial_number?: string | null;
        location?: string | null;
      } | null;
    },
    extra: Record<string, any> = {},
  ) {
    const serial = task?.equipment?.eg_serial_number || '';
    return {
      name: task?.name || '',
      task_link: task?.id != null ? String(task.id) : '',
      description: extra.description || task?.description || '',
      serial_number: serial,
      Serial_number: serial,
      location: task?.equipment?.location || '',
      image_url: extra.image_url || '',
      channel_id: extra.channel_id || 'evergreen_normal',
      action: extra.action || '',
      ...extra,
    };
  }

  async getUsersForLevels(
    levels: access_level[],
    companyLink?: number,
  ): Promise<{ id: number; email: string | null }[]> {
    if (!levels?.length) {
      return [];
    }

    const globalLevels = levels.filter(
      (level) => level === ROLE.ADMIN || level === ROLE.MANAGER,
    );
    const companyLevels = levels.filter(
      (level) => level !== ROLE.ADMIN && level !== ROLE.MANAGER,
    );

    const users: { id: number; email: string | null }[] = [];

    if (globalLevels.length) {
      const globalUsers = await prisma.user.findMany({
        where: { access_level: { in: globalLevels } },
        select: { id: true, email: true },
      });
      users.push(...globalUsers);
    }

    if (companyLevels.length) {
      const where: any = { access_level: { in: companyLevels } };
      if (companyLink != null) {
        where.company_user = { some: { company_link: companyLink } };
      }
      const scopedUsers = await prisma.user.findMany({
        where,
        select: { id: true, email: true },
      });
      users.push(...scopedUsers);
    }

    const unique = new Map<number, { id: number; email: string | null }>();
    for (const user of users) {
      unique.set(user.id, user);
    }
    return [...unique.values()];
  }

  async pushToUsers(
    userIds: number[],
    title: string,
    data: Record<string, any>,
    excludeUserId?: number,
  ) {
    const ids = [...new Set(userIds.filter((id) => id && id !== excludeUserId))];
    if (!ids.length) {
      return;
    }

    const payload = this.asStringData({ title, ...data });

    for (const userId of ids) {
      try {
        await prisma.notifications.create({
          data: {
            title,
            description: payload.description || title,
            image_url: payload.image_url || null,
            task_link: payload.task_link
              ? parseInt(payload.task_link, 10)
              : null,
            user_link: userId,
            is_read: false,
            created_by: 'EG-Backend',
            updated_by: 'EG-Backend',
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to persist notification for user ${userId}: ${error?.message || error}`,
        );
      }

      try {
        const tokens = await prisma.tokens.findMany({
          where: { user_link: userId },
          select: { fcm_id: true },
        });
        const fcmIds = tokens.map((row) => row.fcm_id).filter(Boolean);
        await Promise.all(
          fcmIds.map((token) =>
            this.firebaseService.sendNotification(token, title, payload),
          ),
        );
      } catch (error) {
        this.logger.error(
          `Failed to push to user ${userId}: ${error?.message || error}`,
        );
      }
    }
  }

  async pushToLevels(
    levels: access_level[],
    companyLink: number | undefined,
    title: string,
    data: Record<string, any>,
    excludeUserId?: number,
  ) {
    const users = await this.getUsersForLevels(levels, companyLink);
    await this.pushToUsers(
      users.map((user) => user.id),
      title,
      data,
      excludeUserId,
    );
  }

  async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
    if (!to) {
      return false;
    }
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
      this.logger.warn('SMTP_USER or SMTP_PASS is not set; skipping email');
      return false;
    }
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
    try {
      await transporter.sendMail({ from: user, to, subject, text: body });
      return true;
    } catch (error) {
      this.logger.error(`Email failed to ${to}: ${error?.message || error}`);
      return false;
    }
  }

  async emailToLevels(
    levels: access_level[],
    companyLink: number | undefined,
    subject: string,
    body: string,
  ) {
    const users = await this.getUsersForLevels(levels, companyLink);
    const emails = [
      ...new Set(users.map((user) => user.email).filter(Boolean)),
    ] as string[];
    await Promise.all(
      emails.map((email) => this.sendEmail(email, subject, body)),
    );
  }

  async sendCredentialsEmail(user: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    password?: string | null;
    access_level?: string | null;
  }) {
    if (!user?.email) {
      return;
    }
    const body = `Dear ${user.name || 'User'},

Your EverGreen account has been created.

Role: ${this.roleLabel(user.access_level)}
Login phone: ${user.phone}
Password: ${user.password}

Sign in with your phone number and password. Please change your password after the first login if required.

Best regards,
EverGreen`;
    await this.sendEmail(user.email, 'Your EverGreen account credentials', body);
  }

  private roleLabel(level?: string | null) {
    switch (level) {
      case ROLE.ADMIN:
        return 'Admin';
      case ROLE.MANAGER:
        return 'Manager';
      case ROLE.TECHNICIAN:
        return 'Technician';
      case ROLE.AMC_MANAGER:
        return 'AMC Manager';
      case ROLE.CLIENT:
        return 'Client';
      default:
        return level || 'User';
    }
  }

  async alreadyAlerted(taskLink: number, title: string): Promise<boolean> {
    const existing = await prisma.notifications.findFirst({
      where: { task_link: taskLink, title },
    });
    return !!existing;
  }

  async onNewTask(opts: {
    task: any;
    equipment: any;
    raisedByName: string;
    companyName: string;
    companyLink: number;
    isHighPriority: boolean;
    actorUserId?: number;
  }) {
    const payload = this.taskPayload(
      { ...opts.task, equipment: opts.equipment },
      { description: opts.task?.description || '' },
    );

    await this.pushToLevels(
      [ROLE.TECHNICIAN],
      opts.companyLink,
      'New task received',
      {
        ...payload,
        description: `New task from ${opts.companyName}. Use Assign to me to take this task without opening the full ticket.`,
        channel_id: 'evergreen',
        action: 'assign',
      },
    );

    await this.pushToLevels(
      [ROLE.ADMIN],
      undefined,
      'New AMC task',
      {
        ...payload,
        description: `A new task was raised by ${opts.raisedByName} from ${opts.companyName}.`,
      },
      opts.actorUserId,
    );

    await this.pushToLevels(
      [ROLE.MANAGER],
      undefined,
      'New task created',
      {
        ...payload,
        description: `A new task was created at ${opts.companyName}: ${opts.task?.name || opts.task?.description || ''}.`,
      },
      opts.actorUserId,
    );

    if (opts.isHighPriority) {
      await this.emailToLevels(
        [ROLE.ADMIN],
        undefined,
        `High priority task: ${opts.task?.name || opts.task?.id}`,
        `A high priority (breakdown) task was created.

Company: ${opts.companyName}
Raised by: ${opts.raisedByName}
Task: ${opts.task?.name || ''}
Description: ${opts.task?.description || ''}
Serial: ${opts.equipment?.eg_serial_number || ''}
Location: ${opts.equipment?.location || ''}

Please review this task in the EverGreen app.`,
      );
    }
  }

  async onTechnicianAssigned(opts: {
    task: any;
    equipment: any;
    companyLink: number;
    companyName: string;
    technicianName: string;
    technicianUserId: number;
    assignedByUserId?: number;
    assignedByName?: string;
    selfAssigned: boolean;
  }) {
    const payload = this.taskPayload(
      { ...opts.task, equipment: opts.equipment },
      {
        description: `${opts.technicianName} was assigned to task ${opts.task?.name || opts.task?.id} at ${opts.companyName}.`,
      },
    );

    await this.pushToLevels(
      [ROLE.ADMIN],
      undefined,
      'Technician assigned',
      payload,
      opts.assignedByUserId,
    );

    await this.pushToLevels(
      [ROLE.AMC_MANAGER],
      opts.companyLink,
      'Technician assigned',
      payload,
      opts.assignedByUserId,
    );

    if (!opts.selfAssigned && opts.technicianUserId) {
      await this.pushToUsers(
        [opts.technicianUserId],
        'Task assigned to you',
        {
          ...payload,
          description: `${opts.assignedByName || 'Someone'} assigned you a task at ${opts.companyName}.`,
          channel_id: 'evergreen_normal',
          action: '',
        },
      );
    }
  }

  async onTaskStatusUpdated(opts: {
    task: any;
    equipment: any;
    companyLink: number;
    companyName: string;
    statusLabel: string;
    updatedByName: string;
    actorUserId?: number;
    notes?: string;
    isCompleted: boolean;
  }) {
    const notesBit = opts.notes ? ` Notes: ${opts.notes}` : '';
    const payload = this.taskPayload(
      { ...opts.task, equipment: opts.equipment },
      {
        description: `Status is now ${opts.statusLabel} (updated by ${opts.updatedByName}).${notesBit}`,
      },
    );

    await this.pushToLevels(
      [ROLE.AMC_MANAGER, ROLE.CLIENT],
      opts.companyLink,
      'Task status updated',
      payload,
      opts.actorUserId,
    );

    await this.pushToLevels(
      [ROLE.ADMIN],
      undefined,
      'Task updated',
      {
        ...payload,
        description: `${opts.updatedByName} updated task ${opts.task?.name || opts.task?.id}.${notesBit}`,
      },
      opts.actorUserId,
    );

    await this.pushToLevels(
      [ROLE.MANAGER],
      undefined,
      'Ticket updated',
      payload,
      opts.actorUserId,
    );

    if (opts.isCompleted) {
      await this.pushToLevels(
        [ROLE.AMC_MANAGER],
        opts.companyLink,
        'Task completed',
        {
          ...payload,
          description: `Task ${opts.task?.name || opts.task?.id} was completed by ${opts.updatedByName}.`,
        },
        opts.actorUserId,
      );
    }
  }

  async onTaskNotesUpdated(opts: {
    task: any;
    equipment: any;
    companyLink: number;
    updatedByName: string;
    actorUserId?: number;
    notes?: string;
  }) {
    const payload = this.taskPayload(
      { ...opts.task, equipment: opts.equipment },
      {
        description: `${opts.updatedByName} updated task notes${opts.notes ? `: ${opts.notes}` : ''}.`,
      },
    );

    await this.pushToLevels(
      [ROLE.ADMIN],
      undefined,
      'Task notes updated',
      payload,
      opts.actorUserId,
    );

    await this.pushToLevels(
      [ROLE.MANAGER],
      undefined,
      'Ticket updated',
      payload,
      opts.actorUserId,
    );
  }

  async onFeedback(opts: {
    task: any;
    equipment: any;
    companyLink: number;
    technicianUserId?: number;
    actorUserId?: number;
    submittedByName: string;
    feedback?: string;
    rating?: number;
  }) {
    const payload = this.taskPayload(
      { ...opts.task, equipment: opts.equipment },
      {
        description: `${opts.submittedByName} submitted feedback${opts.rating != null ? ` (rating ${opts.rating})` : ''}${opts.feedback ? `: ${opts.feedback}` : ''}.`,
      },
    );

    await this.pushToLevels(
      [ROLE.ADMIN],
      undefined,
      'Feedback received',
      payload,
      opts.actorUserId,
    );

    await this.pushToLevels(
      [ROLE.MANAGER],
      undefined,
      'Feedback received',
      payload,
      opts.actorUserId,
    );

    if (opts.technicianUserId) {
      await this.pushToUsers(
        [opts.technicianUserId],
        'Feedback received',
        payload,
        opts.actorUserId,
      );
    }
  }

  async onNewTechnician(opts: {
    technicianName: string;
    companyLink?: number;
    actorUserId?: number;
  }) {
    await this.pushToLevels(
      [ROLE.MANAGER],
      undefined,
      'New technician added',
      {
        description: `${opts.technicianName} was added as a technician.`,
        image_url: '',
        task_link: '',
        channel_id: 'evergreen_normal',
        action: '',
      },
      opts.actorUserId,
    );
  }

  async onNewAmc(opts: {
    companyName: string;
    managerName: string;
    location?: string;
  }) {
    await this.emailToLevels(
      [ROLE.ADMIN],
      undefined,
      `New AMC created: ${opts.companyName}`,
      `A new AMC has been created.

AMC: ${opts.companyName}
AMC manager: ${opts.managerName}
Location: ${opts.location || ''}

This is an automated EverGreen notification.`,
    );
  }

  async runHoldAlerts() {
    try {
    const holdRows = await prisma.task_user.findMany({
      where: { status: status.hold },
      orderBy: { id: 'desc' },
      include: {
        task: {
          include: {
            equipment: {
              include: { company: true },
            },
          },
        },
      },
    });

    const seen = new Set<number>();
    const now = Date.now();

    for (const row of holdRows) {
      if (seen.has(row.task_link)) {
        continue;
      }
      seen.add(row.task_link);

      const latest = await prisma.task_user.findFirst({
        where: { task_link: row.task_link },
        orderBy: { id: 'desc' },
      });
      if (!latest || latest.status !== status.hold) {
        continue;
      }

      const heldSince = (
        latest.updated_at || latest.created_at
      ).getTime();
      const hours = (now - heldSince) / (1000 * 60 * 60);
      const equipment = row.task?.equipment;
      const payload = this.taskPayload(
        { ...row.task, equipment },
        { description: 'This task is still on hold.' },
      );

      if (hours >= 8 && latest.technician_link) {
        const title = 'Task on hold for more than 8 hours';
        if (!(await this.alreadyAlerted(row.task_link, title))) {
          await this.pushToUsers([latest.technician_link], title, {
            ...payload,
            description: `Your task ${row.task?.name || row.task_link} has been on hold for more than 8 hours. Please update it.`,
          });
        }
      }

      if (hours >= 24) {
        const title = 'Task on hold for more than 24 hours';
        if (!(await this.alreadyAlerted(row.task_link, title))) {
          await this.pushToLevels([ROLE.ADMIN], undefined, title, {
            ...payload,
            description: `Task ${row.task?.name || row.task_link} at ${equipment?.company?.name || ''} has been on hold for more than 24 hours.`,
          });
          await this.emailToLevels(
            [ROLE.ADMIN],
            undefined,
            `Task on hold over 24 hours: ${row.task?.name || row.task_link}`,
            `The following task has been on hold for more than 24 hours.

Company: ${equipment?.company?.name || ''}
Task: ${row.task?.name || ''}
Description: ${row.task?.description || ''}
Serial: ${equipment?.eg_serial_number || ''}
Location: ${equipment?.location || ''}

Please follow up in the EverGreen app.`,
          );
        }
      }
    }
    } catch (error) {
      this.logger.warn(
        `Hold alerts skipped: ${error?.message || error}`,
      );
    }
  }
}
