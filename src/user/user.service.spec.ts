import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  NotificationService,
  taskPlaceLabel,
  taskPlaceLines,
} from '../notification/notification.service';

// Every prisma.<model>.<method> is a jest.fn resolving to null unless a test sets it.
const mockPrisma: Record<string, any> = {};
const mockModel = () =>
  new Proxy({} as Record<string, jest.Mock>, {
    get: (methods, method: string) => (methods[method] ??= jest.fn().mockResolvedValue(null)),
  });
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    PrismaClient: jest.fn().mockImplementation(
      () => new Proxy({}, { get: (_target, key: string) => (mockPrisma[key] ??= mockModel()) }),
    ),
  };
});
const db = (model: string) => (mockPrisma[model] ??= mockModel());

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};
const sent = (res) => res.send.mock.calls[0][0];

describe('UserService', () => {
  let service: UserService;
  let notifications: Record<string, jest.Mock>;

  beforeEach(async () => {
    for (const key of Object.keys(mockPrisma)) delete mockPrisma[key];
    notifications = {
      onNewTask: jest.fn(),
      onTaskStatusUpdated: jest.fn(),
      onTechnicianAssigned: jest.fn(),
      onTaskNotesUpdated: jest.fn(),
      onFeedback: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: FirebaseService, useValue: {} },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('withoutPassword', () => {
    it('drops only the password field', () => {
      const row = { id: 1, name: 'A', password: 'secret', company_user: [] };
      expect(service.withoutPassword(row)).toEqual({ id: 1, name: 'A', company_user: [] });
      expect(row.password).toBe('secret');
    });

    it('passes through empty values', () => {
      expect(service.withoutPassword(null)).toBeNull();
      expect(service.withoutPassword(undefined)).toBeUndefined();
    });
  });

  describe('parseCompanyIds', () => {
    it('accepts a single id, arrays and numeric strings', () => {
      expect(service.parseCompanyIds(3)).toEqual([3]);
      expect(service.parseCompanyIds(['4', 5, 'x'])).toEqual([4, 5]);
      expect(service.parseCompanyIds(undefined)).toEqual([]);
      expect(service.parseCompanyIds('')).toEqual([]);
    });
  });

  describe('createUserDecision', () => {
    const decide = (actorLevel, actorCompanies: number[], level, companies: number[]) =>
      (service as any).createUserDecision(actorLevel, actorCompanies, level, companies);

    it('lets admins create any role except super admin', () => {
      expect(decide('eg_admin', [], 'technician', [])).toEqual({ allowed: true, companyIds: [] });
      expect(decide('eg_admin', [], 'client', [9])).toEqual({ allowed: true, companyIds: [9] });
      expect(decide('eg_admin', [], 'eg_super_admin', [])).toMatchObject({ allowed: false });
      expect(decide('eg_super_admin', [], 'eg_super_admin', [])).toMatchObject({ allowed: true });
    });

    it('limits client admins to client roles in their own companies', () => {
      expect(decide('client_admin', [1, 2], 'client', [2])).toEqual({ allowed: true, companyIds: [2] });
      expect(decide('client_admin', [1, 2], 'client_admin', [])).toEqual({ allowed: true, companyIds: [1, 2] });
      expect(decide('client_admin', [1], 'client', [1, 3])).toMatchObject({ allowed: false });
      expect(decide('client_admin', [1], 'technician', [])).toMatchObject({ allowed: false });
      expect(decide('client_admin', [1], 'eg_admin', [])).toMatchObject({ allowed: false });
      expect(decide('client_admin', [], 'client', [])).toMatchObject({ allowed: false });
    });

    it('denies everyone else', () => {
      for (const level of ['client', 'technician', 'others', undefined]) {
        expect(decide(level, [1], 'client', [1])).toMatchObject({ allowed: false });
      }
    });
  });

  describe('updateUserDecision', () => {
    const who = (id: number, access_level: string, companyIds: number[] = []) => ({ id, access_level, companyIds });
    const decide = (actor, target, level?, companies?) =>
      (service as any).updateUserDecision(actor, target, level, companies);

    it('lets admins update anyone but only super admins touch super admin', () => {
      expect(decide(who(1, 'eg_admin'), who(2, 'technician'), 'client')).toEqual({ allowed: true, mode: 'admin' });
      expect(decide(who(1, 'eg_admin'), who(2, 'client'), 'eg_super_admin')).toMatchObject({ allowed: false });
      expect(decide(who(1, 'eg_admin'), who(2, 'eg_super_admin'), 'eg_admin')).toMatchObject({ allowed: false });
      expect(decide(who(1, 'eg_admin'), who(2, 'eg_super_admin'))).toMatchObject({ allowed: true });
      expect(decide(who(1, 'eg_super_admin'), who(2, 'client'), 'eg_super_admin')).toMatchObject({ allowed: true });
    });

    it('treats non-admin self edits as self mode regardless of requested role', () => {
      expect(decide(who(5, 'technician'), who(5, 'technician'), 'eg_admin', [1])).toEqual({ allowed: true, mode: 'self' });
      expect(decide(who(5, 'client'), who(5, 'client'))).toEqual({ allowed: true, mode: 'self' });
    });

    it('lets client admins manage client users in shared companies', () => {
      const ca = who(1, 'client_admin', [10, 11]);
      expect(decide(ca, who(2, 'client', [10]), 'client_admin', [11])).toEqual({ allowed: true, mode: 'client_admin' });
      expect(decide(ca, who(2, 'client', [12]))).toMatchObject({ allowed: false });
      expect(decide(ca, who(2, 'technician', [10]))).toMatchObject({ allowed: false });
      expect(decide(ca, who(2, 'client', [10]), 'eg_admin')).toMatchObject({ allowed: false });
      expect(decide(ca, who(2, 'client', [10]), undefined, [12])).toMatchObject({ allowed: false });
    });

    it('denies other roles editing someone else', () => {
      expect(decide(who(1, 'client', [10]), who(2, 'client', [10]))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'technician'), who(2, 'technician'))).toMatchObject({ allowed: false });
    });
  });

  describe('deleteUserDecision', () => {
    const who = (id: number, access_level: string, companyIds: number[] = []) => ({ id, access_level, companyIds });
    const decide = (actor, target) => (service as any).deleteUserDecision(actor, target);

    it('applies admin and client admin rules', () => {
      expect(decide(who(1, 'eg_admin'), who(2, 'technician'))).toEqual({ allowed: true });
      expect(decide(who(1, 'eg_admin'), who(1, 'eg_admin'))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'eg_admin'), who(2, 'eg_super_admin'))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'client_admin', [3]), who(2, 'client', [3]))).toEqual({ allowed: true });
      expect(decide(who(1, 'client_admin', [3]), who(2, 'client', [4]))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'client_admin', [3]), who(2, 'technician', [3]))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'client', [3]), who(2, 'client', [3]))).toMatchObject({ allowed: false });
    });
  });

  describe('taskManageDecision', () => {
    const who = (id: number, access_level: string, companyIds: number[] = []) => ({ id, access_level, companyIds });
    const decide = (actor, raisedBy, companyLink) =>
      (service as any).taskManageDecision(actor, raisedBy, companyLink);

    it('allows admins, the raiser and linked client admins only', () => {
      expect(decide(who(1, 'eg_admin'), 9, 3)).toBe(true);
      expect(decide(who(9, 'client'), 9, 3)).toBe(true);
      expect(decide(who(8, 'client', [3]), 9, 3)).toBe(false);
      expect(decide(who(8, 'client_admin', [3]), 9, 3)).toBe(true);
      expect(decide(who(8, 'client_admin', [4]), 9, 3)).toBe(false);
      expect(decide(who(9, 'technician', [3]), 9, 3)).toBe(false);
    });
  });

  describe('canTriage', () => {
    it('allows admins and senior service engineers only', () => {
      expect(service.canTriage({ access_level: 'eg_admin' })).toBe(true);
      expect(service.canTriage({ access_level: 'eg_super_admin' })).toBe(true);
      expect(service.canTriage({ access_level: 'technician', designation: 'Senior Service Engineer' })).toBe(true);
      expect(service.canTriage({ access_level: 'technician', designation: 'senior service engineer ' })).toBe(true);
      expect(service.canTriage({ access_level: 'technician', designation: 'Junior Technician' })).toBe(false);
      expect(service.canTriage({ access_level: 'technician', designation: 'Junior Service Engineer' })).toBe(false);
      expect(service.canTriage({ access_level: 'client_admin', designation: 'Senior Service Engineer' })).toBe(false);
      expect(service.canTriage(null)).toBe(false);
    });
  });

  describe('approval transitions', () => {
    it('requests approval only for client-side raisers', () => {
      expect(service.approvalOnCreate('client')).toBe('requested');
      expect(service.approvalOnCreate('client_admin')).toBe('requested');
      expect(service.approvalOnCreate('others')).toBe('requested');
      expect(service.approvalOnCreate(undefined)).toBe('requested');
      expect(service.approvalOnCreate('eg_admin')).toBe('approved');
      expect(service.approvalOnCreate('technician')).toBe('approved');
    });

    it('maps task_user status to approval like the migration backfill', () => {
      expect(service.approvalForTaskStatus('open', false)).toBe('approved');
      expect(service.approvalForTaskStatus('open', true)).toBe('assigned');
      expect(service.approvalForTaskStatus('hold', true)).toBe('in_service');
      expect(service.approvalForTaskStatus('in_progress', true)).toBe('in_service');
      expect(service.approvalForTaskStatus('completed', true)).toBe('completed');
      expect(service.approvalForTaskStatus('closed', true)).toBe('confirmed');
      expect(service.approvalForTaskStatus(undefined, true)).toBeNull();
    });

    it('approves and rejects only requested tickets', () => {
      expect(service.nextApprovalState('approve', 'requested')).toBe('approved');
      expect(service.nextApprovalState('reject', 'requested')).toBe('rejected');
      for (const current of ['approved', 'assigned', 'in_service', 'completed', 'confirmed', 'rejected']) {
        expect(service.nextApprovalState('approve', current)).toBeNull();
        expect(service.nextApprovalState('reject', current)).toBeNull();
      }
    });

    it('unassigns back to approved from active states only', () => {
      expect(service.nextApprovalState('unassign', 'assigned')).toBe('approved');
      expect(service.nextApprovalState('unassign', 'in_service')).toBe('approved');
      expect(service.nextApprovalState('unassign', 'approved')).toBe('approved');
      expect(service.nextApprovalState('unassign', 'requested')).toBeNull();
      expect(service.nextApprovalState('unassign', 'completed')).toBeNull();
      expect(service.nextApprovalState('unassign', 'confirmed')).toBeNull();
      expect(service.nextApprovalState('unassign', 'rejected')).toBeNull();
    });
  });

  describe('PM schedule dates', () => {
    it('normalizes frequency labels', () => {
      expect(service.normalizePmFrequency('Monthly')).toBe('monthly');
      expect(service.normalizePmFrequency('half-yearly')).toBe('half_yearly');
      expect(service.normalizePmFrequency('Half Yearly')).toBe('half_yearly');
      expect(service.normalizePmFrequency('annual')).toBe('yearly');
      expect(service.normalizePmFrequency('weekly')).toBeNull();
    });

    it('advances next_due by calendar months in UTC', () => {
      const due = new Date('2026-10-15T09:30:00Z');
      expect(service.advancePmDueDate(due, 'monthly' as any).toISOString()).toBe('2026-11-15T09:30:00.000Z');
      expect(service.advancePmDueDate(due, 'quarterly' as any).toISOString()).toBe('2027-01-15T09:30:00.000Z');
      expect(service.advancePmDueDate(due, 'half_yearly' as any).toISOString()).toBe('2027-04-15T09:30:00.000Z');
      expect(service.advancePmDueDate(due, 'yearly' as any).toISOString()).toBe('2027-10-15T09:30:00.000Z');
      expect(due.toISOString()).toBe('2026-10-15T09:30:00.000Z');
    });

    it('clamps month-end dates', () => {
      expect(service.advancePmDueDate(new Date('2027-01-31T00:00:00Z'), 'monthly' as any).toISOString()).toBe(
        '2027-02-28T00:00:00.000Z',
      );
      expect(service.advancePmDueDate(new Date('2027-08-31T00:00:00Z'), 'half_yearly' as any).toISOString()).toBe(
        '2028-02-29T00:00:00.000Z',
      );
    });
  });

  describe('auditScopeDecision', () => {
    it('gives admins everything and client admins their companies', () => {
      expect(service.auditScopeDecision({ access_level: 'eg_admin', companyIds: [] })).toEqual({ scope: 'all' });
      expect(service.auditScopeDecision({ access_level: 'eg_super_admin', companyIds: [1] })).toEqual({ scope: 'all' });
      expect(service.auditScopeDecision({ access_level: 'client_admin', companyIds: [4, 5] })).toEqual({
        scope: 'companies',
        companyIds: [4, 5],
      });
    });

    it('limits clients and service engineers to their own entries', () => {
      expect(service.auditScopeDecision({ id: 24, access_level: 'client', companyIds: [1] })).toEqual({
        scope: 'self',
        actorId: 24,
      });
      expect(service.auditScopeDecision({ id: 26, access_level: 'technician', companyIds: [] })).toEqual({
        scope: 'self',
        actorId: 26,
      });
    });

    it('denies everyone else, including unlinked client admins', () => {
      expect(service.auditScopeDecision({ id: 25, access_level: 'client_admin', companyIds: [] })).toEqual({
        scope: 'none',
      });
      expect(service.auditScopeDecision({ id: 30, access_level: 'others', companyIds: [1] })).toEqual({ scope: 'none' });
      expect(service.auditScopeDecision({ access_level: 'client', companyIds: [1] })).toEqual({ scope: 'none' });
      expect(service.auditScopeDecision(null)).toEqual({ scope: 'none' });
    });
  });

  describe('getAuditLogs scoping', () => {
    const users = {
      admin: { id: 1, phone: 'p1', access_level: 'eg_admin', company_user: [] },
      clientAdmin: { id: 25, phone: 'p25', access_level: 'client_admin', company_user: [{ company_link: 1 }, { company_link: 2 }] },
      client: { id: 24, phone: 'p24', access_level: 'client', company_user: [{ company_link: 1 }] },
      senior: { id: 26, phone: 'p26', access_level: 'technician', designation: 'Senior Service Engineer', company_user: [] },
      junior: { id: 27, phone: 'p27', access_level: 'technician', designation: 'Junior Service Engineer', company_user: [] },
    };
    const run = async (user, body: Record<string, unknown> = {}) => {
      db('user').findFirst.mockResolvedValue(user);
      db('audit_log').count.mockResolvedValue(42);
      db('audit_log').findMany.mockResolvedValue([{ id: 9 }]);
      const res = mockRes();
      await service.getAuditLogs(res, { user: { phone: user.phone }, body });
      return res;
    };

    it('gives admins every entry', async () => {
      const res = await run(users.admin);
      expect(db('audit_log').findMany.mock.calls[0][0].where).toEqual({ entity: undefined });
      expect(sent(res)).toMatchObject({ status: 200, total: 42, page: 1, limit: 20, data: [{ id: 9 }] });
    });

    it('gives client admins entries whose actor is in one of their companies', async () => {
      await run(users.clientAdmin);
      expect(db('audit_log').findMany.mock.calls[0][0].where).toEqual({
        entity: undefined,
        actor: { company_user: { some: { company_link: { in: [1, 2] } } } },
      });
    });

    it.each([
      ['client', users.client],
      ['senior service engineer', users.senior],
      ['junior service engineer', users.junior],
    ])('gives a %s only the entries they acted on', async (_label, user) => {
      const res = await run(user);
      const expected = { entity: undefined, actor_link: user.id };
      expect(db('audit_log').count.mock.calls[0][0].where).toEqual(expected);
      expect(db('audit_log').findMany.mock.calls[0][0].where).toEqual(expected);
      expect(sent(res).status).toBe(200);
    });

    it('keeps pagination and the entity filter on the self scope', async () => {
      const res = await run(users.junior, { page: 3, limit: 5, entity: 'Task' });
      const query = db('audit_log').findMany.mock.calls[0][0];
      expect(query.where).toEqual({ entity: 'task', actor_link: 27 });
      expect(query.skip).toBe(10);
      expect(query.take).toBe(5);
      expect(sent(res)).toMatchObject({ status: 200, page: 3, limit: 5, total: 42 });
    });

    it('still rejects an unknown entity filter', async () => {
      const res = await run(users.client, { entity: 'nope' });
      expect(sent(res).status).toBe(400);
      expect(db('audit_log').findMany).not.toHaveBeenCalled();
    });
  });

  describe('single-equipment reads for client-side callers', () => {
    const FORBIDDEN = { status: 403, message: 'This equipment does not belong to your company' };
    const users = {
      admin: { id: 1, phone: 'p1', access_level: 'eg_super_admin', company_user: [] },
      technician: { id: 26, phone: 'p26', access_level: 'technician', designation: 'Junior Service Engineer', company_user: [] },
      clientAdmin: { id: 25, phone: 'p25', access_level: 'client_admin', company_user: [{ company_link: 1 }] },
      client: { id: 24, phone: 'p24', access_level: 'client', company_user: [{ company_link: 1 }] },
    };
    const own = { id: 10, company_link: 1, eg_serial_number: 'EG-10', company: { id: 1, name: 'Own' } };
    const foreign = { id: 20, company_link: 2, eg_serial_number: 'EG-20', company: { id: 2, name: 'Other' } };
    const asUser = (user) => {
      db('user').findFirst.mockResolvedValue(user);
      return { phone: user.phone, sub: user.id };
    };

    describe('getEquipmentInfo', () => {
      const info = async (user, equipment, link: unknown = equipment?.id) => {
        db('equipment').findUnique.mockResolvedValue(equipment);
        db('equipment').findFirst.mockResolvedValue(equipment);
        db('task_user').findMany.mockResolvedValue([]);
        const res = mockRes();
        await service.getEquipmentInfo(res, { user: asUser(user), body: { equipment_link: link } });
        return sent(res);
      };

      it.each([
        ['client', users.client],
        ['client admin', users.clientAdmin],
      ])('refuses a %s equipment from another company, by id or serial', async (_label, user) => {
        expect(await info(user, foreign)).toEqual({ ...FORBIDDEN, success: 403 });
        expect(await info(user, foreign, 'EG-20')).toEqual({ ...FORBIDDEN, success: 403 });
        expect(db('task_user').findMany).not.toHaveBeenCalled();
      });

      it('refuses equipment with no company', async () => {
        expect(await info(users.client, { ...foreign, company_link: null, company: null })).toMatchObject(FORBIDDEN);
      });

      it.each([
        ['client', users.client, own],
        ['client admin', users.clientAdmin, own],
        ['admin', users.admin, foreign],
        ['technician', users.technician, foreign],
      ])('returns the equipment to a %s with access', async (_label, user, equipment) => {
        const body = await info(user, equipment);
        expect(body.success).toBe(200);
        expect(body.data.id).toBe(equipment.id);
      });

      it('still reports a missing equipment as not found', async () => {
        expect((await info(users.client, null, 999)).success).toBe(404);
      });
    });

    describe('verifyEquipment', () => {
      const verify = async (user, equipment) => {
        db('equipment').findUnique.mockResolvedValue(equipment);
        db('equipment').update.mockResolvedValue({ ...equipment, verified_by: user.id });
        const res = mockRes();
        await service.verifyEquipment(res, { user: asUser(user), body: { equipment_link: equipment.id } });
        return sent(res);
      };

      it.each([
        ['client', users.client],
        ['client admin', users.clientAdmin],
      ])('refuses a %s equipment from another company', async (_label, user) => {
        expect(await verify(user, foreign)).toEqual(FORBIDDEN);
        expect(db('equipment').update).not.toHaveBeenCalled();
      });

      it.each([
        ['client', users.client, own],
        ['admin', users.admin, foreign],
        ['technician', users.technician, foreign],
      ])('lets a %s with access verify', async (_label, user, equipment) => {
        expect((await verify(user, equipment)).status).toBe(200);
      });
    });

    describe('getAllEquipments with equipment_link', () => {
      const list = async (user, equipment) => {
        db('company_user').findMany.mockResolvedValue(user.company_user);
        db('equipment').findUnique.mockResolvedValue(equipment);
        db('equipment').findMany.mockResolvedValue([equipment]);
        const res = mockRes();
        await service.getAllEquipments(res, { user: asUser(user), body: { equipment_link: equipment.id } });
        return sent(res);
      };

      it('refuses a client equipment from another company', async () => {
        expect(await list(users.client, foreign)).toEqual(FORBIDDEN);
        expect(db('equipment').findMany).not.toHaveBeenCalled();
      });

      it('returns own equipment to a client and any equipment to a technician', async () => {
        expect((await list(users.client, own)).status).toBe(200);
        expect((await list(users.technician, foreign)).status).toBe(200);
      });
    });

    describe('qrCodeGenerator (generateEquipmentPDF)', () => {
      const qr = async (user, body, rows) => {
        db('equipment').findMany.mockResolvedValue(rows);
        jest.spyOn(service, 'createPDF').mockResolvedValue(new Uint8Array([1]));
        const res = mockRes();
        res.setHeader = jest.fn();
        await service.generateEquipmentPDF(res, { user: asUser(user), body });
        return res;
      };

      it('refuses a client admin QR codes for another company or its equipment', async () => {
        let res = await qr(users.clientAdmin, { company_link: 2 }, [foreign]);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(sent(res)).toEqual(FORBIDDEN);
        res = await qr(users.clientAdmin, { equipment_link: [10, 20] }, [own, foreign]);
        expect(sent(res)).toEqual(FORBIDDEN);
        expect(service.createPDF).not.toHaveBeenCalled();
      });

      it('builds the PDF for own equipment and for admins', async () => {
        let res = await qr(users.clientAdmin, { company_link: 1 }, [own]);
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
        res = await qr(users.admin, { company_link: 2 }, [foreign]);
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      });
    });
  });

  describe('canSeeTask', () => {
    const who = (id: number, access_level: string, companyIds: number[] = [], designation?: string) => ({
      id,
      access_level,
      companyIds,
      designation,
    });

    it('scopes ticket visibility by role', () => {
      expect(service.canSeeTask(who(1, 'eg_admin'), 9, 3)).toBe(true);
      expect(service.canSeeTask(who(1, 'technician', [], 'Senior Service Engineer'), 9, 3)).toBe(true);
      expect(service.canSeeTask(who(9, 'technician'), 9, 3)).toBe(true);
      expect(service.canSeeTask(who(8, 'technician'), 9, 3)).toBe(false);
      expect(service.canSeeTask(who(8, 'technician'), null, 3)).toBe(false);
      expect(service.canSeeTask(who(5, 'client', [3]), 9, 3)).toBe(true);
      expect(service.canSeeTask(who(5, 'client_admin', [4]), 9, 3)).toBe(false);
      expect(service.canSeeTask(null, 9, 3)).toBe(false);
    });
  });

  describe('setUserActiveDecision', () => {
    const who = (id: number, access_level: string, companyIds: number[] = []) => ({ id, access_level, companyIds });
    const decide = (actor, target) => (service as any).setUserActiveDecision(actor, target);

    it('follows the delete rules with status wording', () => {
      expect(decide(who(1, 'eg_admin'), who(2, 'technician'))).toEqual({ allowed: true });
      expect(decide(who(1, 'eg_admin'), who(1, 'eg_admin'))).toEqual({
        allowed: false,
        message: 'You cannot change the status of your own account',
      });
      expect(decide(who(1, 'eg_admin'), who(2, 'eg_super_admin'))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'eg_super_admin'), who(2, 'eg_super_admin'))).toEqual({ allowed: true });
      expect(decide(who(1, 'client_admin', [3]), who(2, 'client_admin', [3]))).toEqual({ allowed: true });
      expect(decide(who(1, 'client_admin', [3]), who(2, 'client', [4]))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'client_admin', [3]), who(2, 'technician', [3]))).toMatchObject({ allowed: false });
      expect(decide(who(1, 'technician'), who(2, 'technician'))).toMatchObject({ allowed: false });
    });

    it('keeps the delete messages unchanged', () => {
      expect((service as any).deleteUserDecision(who(1, 'eg_admin'), who(1, 'eg_admin'))).toEqual({
        allowed: false,
        message: 'You cannot delete your own account',
      });
    });
  });

  describe('resolveCompanyServiceTerms', () => {
    const resolve = (body: Record<string, unknown>, existing?: any) =>
      (service as any).resolveCompanyServiceTerms(body, existing);

    it('requires a service type', () => {
      expect(resolve({})).toEqual({ error: 'Please select a service type' });
      expect(resolve({ service_type: 'monthly' })).toEqual({
        error: 'Service type must be AMC, Non-AMC or Regular',
      });
    });

    it('requires AMC type and both dates for AMC', () => {
      expect(resolve({ service_type: 'amc' })).toEqual({
        error: 'Please select an AMC type (C AMC or NC AMC)',
      });
      expect(resolve({ service_type: 'AMC', amc_type: 'NC AMC', start_date: '2026-11-01' })).toEqual({
        error: 'Start date and end date are required for AMC',
      });
      expect(
        resolve({ service_type: 'amc', amc_type: 'c_amc', start_date: '2026-11-01', end_date: '2026-10-01' }),
      ).toEqual({ error: 'End date must be on or after start date' });
    });

    it('accepts a complete AMC', () => {
      expect(
        resolve({ service_type: 'amc', amc_type: 'C AMC', start_date: '2026-11-01', end_date: '2027-10-31' }),
      ).toEqual({
        service_type: 'amc',
        amc_type: 'c_amc',
        start_date: new Date('2026-11-01T00:00:00Z'),
        end_date: new Date('2027-10-31T00:00:00Z'),
      });
    });

    it('drops AMC type and dates for Non-AMC and Regular', () => {
      const body = { amc_type: 'c_amc', start_date: '2026-11-01', end_date: '2027-10-31' };
      expect(resolve({ ...body, service_type: 'Non-AMC' })).toEqual({
        service_type: 'non_amc',
        amc_type: null,
        start_date: null,
        end_date: null,
      });
      expect(resolve({ ...body, service_type: 'regular' })).toMatchObject({
        service_type: 'regular',
        start_date: null,
      });
    });

    it('keeps saved values on a partial update', () => {
      const existing = {
        service_type: 'amc',
        amc_type: 'nc_amc',
        start_date: new Date('2026-01-01T00:00:00Z'),
        end_date: new Date('2026-12-31T00:00:00Z'),
      };
      expect(resolve({ end_date: '2027-12-31' }, existing)).toEqual({
        service_type: 'amc',
        amc_type: 'nc_amc',
        start_date: existing.start_date,
        end_date: new Date('2027-12-31T00:00:00Z'),
      });
    });
  });

  describe('normalizeTechnicianDesignation', () => {
    const normalize = (value: unknown) => (service as any).normalizeTechnicianDesignation(value);

    it('returns the canonical service engineer designations', () => {
      expect(normalize('Senior Service Engineer')).toBe('Senior Service Engineer');
      expect(normalize('  senior   service engineer ')).toBe('Senior Service Engineer');
      expect(normalize('Service Engineer')).toBe('Service Engineer');
      expect(normalize('SERVICE ENGINEER')).toBe('Service Engineer');
    });

    it('maps the legacy junior designations to Service Engineer', () => {
      expect(normalize('Junior Service Engineer')).toBe('Service Engineer');
      expect(normalize('Junior Technician')).toBe('Service Engineer');
      expect(normalize(' junior technician ')).toBe('Service Engineer');
    });

    it('rejects anything else', () => {
      for (const value of ['Senior Technician', 'technician', 'Junior', '', null, undefined]) {
        expect(normalize(value)).toBeNull();
      }
    });
  });

  describe('createUser designation validation', () => {
    it('names both new designations in the error', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 1, access_level: 'eg_admin', company_user: [] } as any);
      const res = mockRes();
      await service.createUser(res, {
        user: { phone: '9000000001' },
        body: { access_level: 'technician', designation: 'Field Technician', name: 'T', phone: '9000000002' },
      });
      expect(sent(res)).toEqual({
        status: 400,
        message: 'designation must be Senior Service Engineer or Service Engineer',
      });
    });
  });

  describe('individual task rules', () => {
    it('lets only super admins and admins create individual tasks', () => {
      expect(service.individualTaskCreateDenied('eg_super_admin')).toBeNull();
      expect(service.individualTaskCreateDenied('eg_admin')).toBeNull();
      for (const level of ['technician', 'client_admin', 'client', 'others', undefined]) {
        expect(service.individualTaskCreateDenied(level)).toBe('Only admins can create individual tasks');
      }
    });

    it('requires name, contact_name, contact_phone and address', () => {
      expect(service.individualTaskContact({})).toEqual({
        error: 'name, contact_name, contact_phone, address are required for an individual task',
      });
      expect(service.individualTaskContact({ name: 'AC repair', contact_name: 'Ravi', contact_phone: '9876543210', address: '  ' })).toEqual({
        error: 'address is required for an individual task',
      });
    });

    it('accepts 10-15 digit phones with an optional leading +', () => {
      const base = { name: ' AC repair ', contact_name: ' Ravi ', address: ' 12 MG Road ' };
      expect(service.individualTaskContact({ ...base, contact_phone: '+91 98765-43210' })).toEqual({
        name: 'AC repair',
        contact_name: 'Ravi',
        contact_phone: '+919876543210',
        address: '12 MG Road',
      });
      expect(service.individualTaskContact({ ...base, contact_phone: '123456789012345' })).toMatchObject({
        contact_phone: '123456789012345',
      });
      for (const phone of ['987654321', '1234567890123456', '98765abcde', '++919876543210', '91+9876543210']) {
        expect(service.individualTaskContact({ ...base, contact_phone: phone })).toEqual({
          error: 'contact_phone must be 10 to 15 digits with an optional leading +',
        });
      }
    });
  });

  describe('taskContactUpdate', () => {
    const individual = {
      name: 'AC repair',
      equipment_link: null,
      contact_name: 'Ravi',
      contact_phone: '9876543210',
      address: '12 MG Road',
    };

    it('keeps individual task contact fields non-empty', () => {
      expect(service.taskContactUpdate({ address: '' }, individual)).toEqual({
        error: 'address is required for an individual task',
      });
      expect(service.taskContactUpdate({ name: '  ' }, individual)).toEqual({
        error: 'name is required for an individual task',
      });
      expect(service.taskContactUpdate({ contact_phone: '12' }, individual)).toEqual({
        error: 'contact_phone must be 10 to 15 digits with an optional leading +',
      });
      expect(service.taskContactUpdate({ contact_name: 'Ravi K' }, individual)).toEqual({
        data: { contact_name: 'Ravi K', contact_phone: '9876543210', address: '12 MG Road' },
      });
    });

    it('does nothing when no contact field is sent', () => {
      expect(service.taskContactUpdate({ description: 'x' }, individual)).toEqual({ data: {} });
      expect(service.taskContactUpdate({ name: 'Renamed' }, { ...individual, contact_name: null })).toEqual({ data: {} });
    });

    it('lets equipment tasks set or clear contact fields', () => {
      const normal = { ...individual, equipment_link: 4 };
      expect(service.taskContactUpdate({ address: '', contact_phone: '+91 9876543210' }, normal)).toEqual({
        data: { address: null, contact_phone: '+919876543210' },
      });
      expect(service.taskContactUpdate({ contact_phone: 'abc' }, normal)).toMatchObject({ error: expect.any(String) });
    });

    it('stops enforcing once an individual task is moved onto equipment', () => {
      expect(service.taskContactUpdate({ equipment_link: 4, address: '' }, individual)).toEqual({ data: { address: null } });
    });
  });

  describe('taskListVisible', () => {
    const viewer = (id: number, access_level: string, designation?: string) => ({ id, access_level, designation });
    const individualRow = { technician_link: 7, task: { equipment: null } };
    const companyRow = { technician_link: 7, task: { equipment: { company_link: 3 } } };

    it('never shows individual tasks to clients or client admins', () => {
      expect(service.taskListVisible(viewer(1, 'client'), individualRow, [3])).toBe(false);
      expect(service.taskListVisible(viewer(1, 'client_admin'), individualRow, [3])).toBe(false);
      expect(service.taskListVisible(viewer(1, 'client_admin'), { technician_link: null, task: null }, [3])).toBe(false);
      expect(service.taskListVisible(viewer(1, 'client_admin'), companyRow, [3])).toBe(true);
      expect(service.taskListVisible(viewer(1, 'client'), companyRow, [4])).toBe(false);
    });

    it('shows individual tasks to admins, senior engineers and the assigned engineer only', () => {
      expect(service.taskListVisible(viewer(1, 'eg_admin'), individualRow, [])).toBe(true);
      expect(service.taskListVisible(viewer(1, 'eg_super_admin'), individualRow, [])).toBe(true);
      expect(service.taskListVisible(viewer(2, 'technician', 'Senior Service Engineer'), individualRow, [])).toBe(true);
      expect(service.taskListVisible(viewer(7, 'technician', 'Junior Service Engineer'), individualRow, [])).toBe(true);
      expect(service.taskListVisible(viewer(8, 'technician', 'Junior Service Engineer'), individualRow, [])).toBe(false);
      expect(service.taskListVisible(viewer(8, 'technician'), { technician_link: null, task: { equipment: null } }, [])).toBe(false);
    });
  });

  describe('createTask for individual tasks', () => {
    const body = {
      name: 'AC not cooling',
      description: 'Split AC in bedroom',
      call_type: 'breakdown',
      contact_name: 'Ravi',
      contact_phone: '+91 98765 43210',
      address: '12 MG Road, Bengaluru',
      images: ['uploads/a.png'],
      client_link: 99,
    };
    const asUser = (access_level: string, id = 1) =>
      jest.spyOn(service, 'findOne').mockResolvedValue({ id, name: 'Admin', phone: '9000000001', access_level, company_user: [] } as any);

    it('refuses everyone except admins with a 403 envelope', async () => {
      for (const level of ['client', 'client_admin', 'technician']) {
        asUser(level);
        const res = mockRes();
        await service.createTask(res, { user: { phone: '9000000001' }, body });
        expect(sent(res)).toEqual({ status: 403, message: 'Only admins can create individual tasks' });
        expect(res.status).not.toHaveBeenCalled();
      }
      expect(db('tasks').create).not.toHaveBeenCalled();
      expect(db('equipment').findUnique).not.toHaveBeenCalled();
    });

    it('treats an empty equipment_link as individual and validates the contact', async () => {
      asUser('eg_admin');
      const res = mockRes();
      await service.createTask(res, { user: { phone: '9000000001' }, body: { ...body, equipment_link: '', contact_phone: undefined } });
      expect(sent(res)).toEqual({ status: 400, message: 'contact_phone is required for an individual task' });

      const bad = mockRes();
      await service.createTask(bad, { user: { phone: '9000000001' }, body: { ...body, equipment_link: null, contact_phone: '12345' } });
      expect(sent(bad)).toEqual({ status: 400, message: 'contact_phone must be 10 to 15 digits with an optional leading +' });
      expect(db('tasks').create).not.toHaveBeenCalled();
    });

    it('creates the task, the open task_user row owned by the admin, and notifies by contact', async () => {
      asUser('eg_admin', 5);
      const created = { id: 41, name: 'AC not cooling', ticket_no: 'T-1', call_type: 'breakdown', equipment_link: null, contact_name: 'Ravi', contact_phone: '+919876543210', address: '12 MG Road, Bengaluru' };
      db('tasks').create.mockResolvedValue(created);
      db('task_user').findFirst.mockResolvedValue({ status: 'open' });
      const res = mockRes();
      await service.createTask(res, { user: { phone: '9000000001' }, body });

      const data = db('tasks').create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        name: 'AC not cooling',
        description: 'Split AC in bedroom',
        call_type: 'breakdown',
        equipment_link: null,
        contact_name: 'Ravi',
        contact_phone: '+919876543210',
        address: '12 MG Road, Bengaluru',
        priority: 'high',
        approval: 'approved',
        manager_link: 5,
        image: { create: [{ url: 'uploads/a.png' }] },
      });
      expect(db('tasks').findFirst.mock.calls[0][0].where).toMatchObject({ equipment_link: null, contact_phone: '+919876543210' });
      expect(db('task_user').create.mock.calls[0][0].data).toMatchObject({ client_link: 5, task_link: 41, status: 'open' });
      expect(notifications.onNewTask).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: null, companyLink: undefined, companyName: 'Ravi, 12 MG Road, Bengaluru' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(sent(res)).toEqual({ status: 200, data: created, message: 'task created successfully' });
    });

    it('rejects a duplicate for the same contact phone', async () => {
      asUser('eg_admin');
      db('tasks').findFirst.mockResolvedValue({ id: 3 });
      const res = mockRes();
      await service.createTask(res, { user: { phone: '9000000001' }, body });
      expect(sent(res)).toMatchObject({ status: 409, message: 'task already exist with same name, description, contact_phone and call_type combo' });
    });

    it('keeps the equipment path for normal tasks', async () => {
      asUser('client');
      const res = mockRes();
      await service.createTask(res, { user: { phone: '9000000001' }, body: { ...body, equipment_link: 12 } });
      expect(db('equipment').findUnique).toHaveBeenCalledWith({ where: { id: 12 }, include: { company: true } });
      expect(sent(res)).toEqual({ status: 204, message: 'Equipment with ID 12 is not present in the database' });
    });
  });

  describe('deleteTask (soft delete)', () => {
    const actorAs = (access_level: string) =>
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, name: 'Asha', phone: 'p', access_level, company_user: [] } as any);
    const task = (status: string, extra = {}) => ({
      id: 41,
      ticket_no: 'TKT1',
      name: 'AC not cooling',
      deleted_at: null,
      equipment: { company_link: 3 },
      task_user: [{ id: 9, status, client_link: 20, technician_link: 30 }],
      ...extra,
    });
    const del = async (body) => {
      const res = mockRes();
      await service.deleteTask(res, { user: { phone: 'p' }, body });
      return sent(res);
    };

    beforeEach(() => {
      notifications.pushToUsers = jest.fn();
      notifications.taskPayload = jest.fn(() => ({}));
    });

    it('allows only super admins and managers', async () => {
      for (const level of ['client', 'client_admin', 'technician']) {
        actorAs(level);
        expect(await del({ task_link: 41, reason: 'dup' })).toEqual({ status: 403, message: 'Only admins and managers can delete tasks' });
      }
      expect(db('tasks').update).not.toHaveBeenCalled();
    });

    it('requires a reason', async () => {
      actorAs('eg_admin');
      expect(await del({ task_link: 41, reason: '   ' })).toEqual({ status: 400, message: 'A reason is required to delete a task' });
    });

    it('refuses tasks that are started, closed or already deleted', async () => {
      actorAs('eg_super_admin');
      for (const status of ['in_progress', 'hold', 'completed', 'closed']) {
        db('tasks').findUnique.mockResolvedValue(task(status));
        expect((await del({ task_link: 41, reason: 'dup' })).status).toBe(409);
      }
      db('tasks').findUnique.mockResolvedValue(task('open', { deleted_at: new Date() }));
      expect(await del({ task_link: 41, reason: 'dup' })).toEqual({ status: 204, message: 'Task not found' });
      expect(db('tasks').update).not.toHaveBeenCalled();
    });

    it('marks the task deleted and notifies the POC, client admins and engineer', async () => {
      actorAs('eg_admin');
      db('tasks').findUnique.mockResolvedValue(task('open'));
      db('tasks').update.mockResolvedValue({ id: 41, deleted_at: new Date() });
      db('company_user').findMany.mockResolvedValue([{ user_link: 21 }, { user_link: 22 }]);
      const out = await del({ task_link: 41, reason: '  Raised twice  ' });

      expect(out).toMatchObject({ status: 200, message: 'Task deleted successfully' });
      expect(db('tasks').update.mock.calls[0][0]).toMatchObject({
        where: { id: 41 },
        data: { deleted_by: 5, delete_reason: 'Raised twice' },
      });
      expect(db('tasks').delete).not.toHaveBeenCalled();
      const [userIds, title, , excluded] = notifications.pushToUsers.mock.calls[0];
      expect(userIds).toEqual([20, 30, 21, 22]);
      expect(title).toBe('Ticket deleted');
      expect(excluded).toBe(5);
      expect(notifications.taskPayload.mock.calls[0][1].description).toContain('Reason: Raised twice');
    });
  });

  describe('one active task per equipment', () => {
    const asClient = () =>
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 20, phone: 'p', access_level: 'client', company_user: [] } as any);

    it('finds the latest unclosed, undeleted task', async () => {
      db('tasks').findMany.mockResolvedValue([
        { id: 3, ticket_no: 'C', name: 'closed', task_user: [{ status: 'closed' }] },
        { id: 2, ticket_no: 'B', name: 'waiting', task_user: [{ status: 'completed' }] },
      ]);
      expect(await service.activeTaskForEquipment(8)).toEqual({ id: 2, ticket_no: 'B', name: 'waiting', status: 'completed' });
      expect(db('tasks').findMany.mock.calls[0][0].where).toEqual({ equipment_link: 8, deleted_at: null });
    });

    it('refuses to raise a second task on the same equipment', async () => {
      asClient();
      db('equipment').findUnique.mockResolvedValue({ id: 8, company_link: 3, company: {} });
      db('tasks').findMany.mockResolvedValue([{ id: 2, ticket_no: 'B', name: 'x', task_user: [{ status: 'open' }] }]);
      const res = mockRes();
      await service.createTask(res, { user: { phone: 'p' }, body: { equipment_link: 8, name: 'n', description: 'd', call_type: 'service' } });
      expect(sent(res)).toMatchObject({ status: 409, data: { ticket_no: 'B' } });
      expect(sent(res).message).toContain('Ticket B');
      expect(db('tasks').create).not.toHaveBeenCalled();
    });

    it('raises a task once the earlier one is closed, with issue type and location', async () => {
      asClient();
      db('equipment').findUnique.mockResolvedValue({ id: 8, company_link: 3, company: {} });
      db('tasks').findMany.mockResolvedValue([{ id: 2, ticket_no: 'B', name: 'x', task_user: [{ status: 'closed' }] }]);
      db('issue_type').findUnique.mockResolvedValue({ id: 7, name: 'Gas refill', call_type: null, is_active: true });
      db('tasks').create.mockResolvedValue({ id: 50, ticket_no: 'N' });
      const res = mockRes();
      await service.createTask(res, {
        user: { phone: 'p' },
        body: { equipment_link: 8, name: 'n', description: 'd', issue_type_link: 7, location: ' Block B, 2nd floor ', client_link: 20 },
      });
      expect(db('tasks').create.mock.calls[0][0].data).toMatchObject({ issue_type_link: 7, location: 'Block B, 2nd floor' });
      expect(db('tasks').create.mock.calls[0][0].data.call_type).toBeUndefined();
      expect(sent(res).status).toBe(200);
    });
  });

  describe('resolveIssueType', () => {
    it('rejects an unknown or inactive issue type', async () => {
      db('issue_type').findUnique.mockResolvedValue({ id: 7, is_active: false });
      expect(await service.resolveIssueType({ issue_type_link: 7 })).toEqual({ error: 'issue_type_link must be an active issue type' });
    });

    it('links a legacy call_type to its built-in issue type', async () => {
      db('issue_type').findFirst.mockResolvedValue({ id: 2 });
      expect(await service.resolveIssueType({ call_type: 'Breakdown' })).toEqual({ issue_type_link: 2, call_type: 'breakdown' });
      expect(await service.resolveIssueType({})).toEqual({ issue_type_link: null, call_type: null });
    });
  });

  describe('issue type management', () => {
    const as = (access_level: string) =>
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, name: 'A', phone: 'p', access_level, company_user: [] } as any);
    const call = async (fn: 'createIssueType' | 'updateIssueType', body) => {
      const res = mockRes();
      await service[fn](res, { user: { phone: 'p' }, body });
      return sent(res);
    };

    it('is limited to super admins and managers', async () => {
      as('client_admin');
      expect((await call('createIssueType', { name: 'Gas refill' })).status).toBe(403);
      as('technician');
      expect((await call('updateIssueType', { issue_type_link: 1, is_active: false })).status).toBe(403);
    });

    it('creates a trimmed, case-insensitively unique name', async () => {
      as('eg_admin');
      db('issue_type').findFirst.mockResolvedValue({ id: 1 });
      expect((await call('createIssueType', { name: 'breakdown' })).status).toBe(409);

      db('issue_type').findFirst.mockResolvedValue(null);
      db('issue_type').create.mockResolvedValue({ id: 9, name: 'Gas refill' });
      expect((await call('createIssueType', { name: '  Gas   refill ' })).status).toBe(200);
      expect(db('issue_type').create.mock.calls[0][0].data.name).toBe('Gas refill');
    });

    it('renames or deactivates an issue type', async () => {
      as('eg_super_admin');
      db('issue_type').findUnique.mockResolvedValue({ id: 9, name: 'Gas refill' });
      db('issue_type').update.mockResolvedValue({ id: 9, name: 'Gas refill', is_active: false });
      expect((await call('updateIssueType', { issue_type_link: 9, is_active: 'no' })).status).toBe(400);
      expect((await call('updateIssueType', { issue_type_link: 9, is_active: false })).status).toBe(200);
      expect(db('issue_type').update.mock.calls[0][0].data).toMatchObject({ is_active: false });
    });
  });

  describe('service type management', () => {
    const as = (access_level: string) =>
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, name: 'A', phone: 'p', access_level, company_user: [] } as any);
    const call = async (fn: 'createServiceType' | 'updateServiceType' | 'getServiceTypes', body) => {
      const res = mockRes();
      await service[fn](res, { user: { phone: 'p' }, body });
      return sent(res);
    };

    it('is limited to super admins and managers', async () => {
      as('client');
      const denied = await call('createServiceType', { name: 'Chiller AMC' });
      expect(denied.status).toBe(403);
      expect(denied.message).toBe('Only admins and managers can manage service types');
    });

    it('creates, rejects duplicates and deactivates', async () => {
      as('eg_admin');
      db('service_type').findFirst.mockResolvedValue({ id: 1 });
      expect((await call('createServiceType', { name: 'chiller amc' })).message).toBe('Service type "chiller amc" already exists');

      db('service_type').findFirst.mockResolvedValue(null);
      db('service_type').create.mockResolvedValue({ id: 2, name: 'Chiller AMC' });
      expect((await call('createServiceType', { name: ' Chiller  AMC ' })).status).toBe(200);
      expect(db('service_type').create.mock.calls[0][0].data.name).toBe('Chiller AMC');

      db('service_type').findUnique.mockResolvedValue({ id: 2, name: 'Chiller AMC' });
      db('service_type').update.mockResolvedValue({ id: 2, name: 'Chiller AMC', is_active: false });
      expect((await call('updateServiceType', { service_type_link: 2, is_active: false })).status).toBe(200);
      expect(db('service_type').update.mock.calls[0][0].where).toEqual({ id: 2 });
    });

    it('lists only active types unless an admin asks for all', async () => {
      db('service_type').findMany.mockResolvedValue([]);
      as('client');
      await call('getServiceTypes', { include_inactive: true });
      expect(db('service_type').findMany.mock.calls[0][0].where).toEqual({ is_active: true });
      as('eg_super_admin');
      await call('getServiceTypes', { include_inactive: true });
      expect(db('service_type').findMany.mock.calls[1][0].where).toEqual({});
    });

    it('resolves an equipment service_type_link', async () => {
      expect(await service.resolveServiceTypeLink({})).toEqual({ link: undefined });
      expect(await service.resolveServiceTypeLink({ service_type_link: null })).toEqual({ link: null });
      db('service_type').findUnique.mockResolvedValue({ id: 4, is_active: false });
      expect(await service.resolveServiceTypeLink({ service_type_link: 4 })).toEqual({ error: 'service_type_link must be an active service type' });
      expect(await service.resolveServiceTypeLink({ service_type_link: 4 }, 4)).toEqual({ link: 4 });
      db('service_type').findUnique.mockResolvedValue({ id: 5, is_active: true });
      expect(await service.resolveServiceTypeLink({ service_type_link: '5' })).toEqual({ link: 5 });
    });
  });

  describe('wantsCredentialsEmail', () => {
    it('emails unless send_credentials is false', () => {
      expect(service.wantsCredentialsEmail({})).toBe(true);
      expect(service.wantsCredentialsEmail({ send_credentials: true })).toBe(true);
      expect(service.wantsCredentialsEmail({ send_credentials: false })).toBe(false);
      expect(service.wantsCredentialsEmail({ send_credentials: 'false' })).toBe(false);
    });
  });

  describe('getAllTasks with individual tasks', () => {
    const rows = [
      { id: 1, technician_link: 7, client_link: 5, status: 'open', task: { id: 41, equipment: null, equipment_link: null, contact_name: 'Ravi', image: [], manager_link: null, created_at: new Date('2026-10-02') } },
      { id: 2, technician_link: null, client_link: 9, status: 'open', task: { id: 42, equipment: { company_link: 3, company: { name: 'Acme' } }, equipment_link: 8, image: [{ url: 'x.png' }], manager_link: null, created_at: new Date('2026-10-01') } },
    ];
    const listAs = async (access_level: string, id: number, companies: number[] = []) => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id, access_level, designation: null, company_user: [] } as any);
      db('company_user').findMany.mockResolvedValue(companies.map((company_link) => ({ company_link })));
      mockPrisma.$queryRaw = jest.fn().mockResolvedValue(rows.map(({ id }) => ({ id })));
      db('task_user').findMany.mockResolvedValue(rows);
      const res = mockRes();
      await service.getAllTasks(res, { user: { phone: 'p', sub: id }, body: {} });
      return sent(res);
    };

    it('hides individual tasks from client admins without crashing', async () => {
      const out = await listAs('client_admin', 9, [3]);
      expect(out.data.map((row) => row.task.id)).toEqual([42]);
      expect(out.count.open).toBe(1);
    });

    it('lists individual tasks with their contact fields for admins', async () => {
      const out = await listAs('eg_admin', 5);
      expect(out.data.map((row) => row.task.id)).toEqual([41, 42]);
      expect(out.data[0].task).toMatchObject({ equipment: null, contact_name: 'Ravi', image: [] });
    });

    it('shows an individual task to its assigned service engineer only', async () => {
      expect((await listAs('technician', 7)).data.map((row) => row.task.id)).toEqual([41]);
      expect((await listAs('technician', 8)).data).toEqual([]);
    });

    it('hides deleted tasks; admins can list only deleted ones', async () => {
      await listAs('eg_admin', 5);
      expect(db('task_user').findMany.mock.calls[0][0].where.task).toEqual({ deleted_at: null });

      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, access_level: 'eg_admin', company_user: [] } as any);
      const res = mockRes();
      await service.getAllTasks(res, { user: { phone: 'p', sub: 5 }, body: { deleted: true } });
      expect(db('task_user').findMany.mock.calls[1][0].where.task).toEqual({ deleted_at: { not: null } });

      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 9, access_level: 'client_admin', company_user: [] } as any);
      await service.getAllTasks(mockRes(), { user: { phone: 'p', sub: 9 }, body: { deleted: true } });
      expect(db('task_user').findMany.mock.calls[2][0].where.task).toEqual({ deleted_at: null });
    });

    it('drops individual tasks when filtering by company', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, access_level: 'eg_admin', company_user: [] } as any);
      db('company_user').findMany.mockResolvedValue([]);
      mockPrisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
      db('task_user').findMany.mockResolvedValue(rows);
      const res = mockRes();
      await service.getAllTasks(res, { user: { phone: 'p', sub: 5 }, body: { company_link: 3 } });
      expect(sent(res).data.map((row) => row.task.id)).toEqual([42]);
    });
  });

  describe('updateTaskStatus on an individual task', () => {
    it('updates the status and notifies without a company', async () => {
      const task = { id: 41, name: 'AC not cooling', ticket_no: 'T-1', equipment: null, equipment_link: null, contact_name: 'Ravi', address: '12 MG Road', follow_up: null };
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, name: 'Admin', access_level: 'eg_admin', company_user: [] } as any);
      db('task_user').findUnique.mockResolvedValue({ id: 9, technician_link: 7, client_link: 5, task_link: 41, status: 'open', task });
      db('tasks').findUnique.mockResolvedValue(task);
      db('task_user').update.mockResolvedValue({ id: 9, status: 'in_progress' });
      db('task_user').findFirst.mockResolvedValue({ status: 'in_progress' });
      db('tasks').update.mockResolvedValue(task);
      const res = mockRes();
      await service.updateTaskStatus(res, { user: { phone: 'p', sub: 5 }, body: { task_user_link: 9, status: 'in_progress' } });
      expect(sent(res)).toMatchObject({ status: 200 });
      expect(notifications.onTaskStatusUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: null, companyLink: undefined, companyName: 'Ravi, 12 MG Road' }),
      );
    });
  });

  describe('completing and closing tasks', () => {
    const task = { id: 41, name: 'AC not cooling', ticket_no: 'T-1', equipment_link: 8, equipment: { company_link: 3, company: { name: 'Acme' } } };
    const actorAs = (access_level: string, id = 5, companies = [3]) =>
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id,
        name: 'Asha',
        access_level,
        company_user: companies.map((company_link) => ({ company_link })),
      } as any);
    const run = async (current: string, next: string, opts: { technician?: number | null; sub?: number; body?: any } = {}) => {
      db('task_user').findUnique.mockResolvedValue({
        id: 9,
        technician_link: opts.technician === undefined ? 30 : opts.technician,
        client_link: 20,
        task_link: 41,
        status: current,
        task,
      });
      db('company_user').findUnique.mockResolvedValue({ user_link: opts.sub ?? 5 });
      db('company_user').findMany.mockResolvedValue([{ user_link: 21 }]);
      db('tasks').findUnique.mockResolvedValue(task);
      db('task_user').update.mockResolvedValue({ id: 9, status: next });
      db('task_user').findFirst.mockResolvedValue({ status: next });
      db('tasks').update.mockResolvedValue(task);
      const res = mockRes();
      await service.updateTaskStatus(res, {
        user: { phone: 'p', sub: opts.sub ?? 5 },
        body: { task_user_link: 9, status: next, ...(opts.body ?? {}) },
      });
      return sent(res);
    };

    beforeEach(() => {
      notifications.pushToUsers = jest.fn();
      notifications.taskPayload = jest.fn(() => ({}));
    });

    it('lets super admins, managers, POCs and client admins complete or close an assigned task', async () => {
      for (const level of ['eg_super_admin', 'eg_admin', 'client', 'client_admin']) {
        for (const [current, next] of [['open', 'completed'], ['in_progress', 'closed'], ['hold', 'closed'], ['completed', 'closed']]) {
          actorAs(level);
          expect(await run(current, next)).toMatchObject({ status: 200 });
        }
      }
    });

    it('limits POCs and client admins to their company and to completing or closing', async () => {
      actorAs('client', 5, [99]);
      db('company_user').findUnique.mockResolvedValue(null);
      const outsider = await (async () => {
        db('task_user').findUnique.mockResolvedValue({ id: 9, technician_link: 30, client_link: 20, task_link: 41, status: 'open', task });
        const res = mockRes();
        await service.updateTaskStatus(res, { user: { phone: 'p', sub: 5 }, body: { task_user_link: 9, status: 'closed' } });
        return sent(res);
      })();
      expect(outsider.status).toBe(403);

      actorAs('client_admin');
      expect(await run('open', 'in_progress')).toMatchObject({ status: 403 });
      actorAs('client');
      expect(await run('closed', 'completed')).toMatchObject({ status: 409, message: 'This task is already closed' });
    });

    it('still needs an engineer assigned', async () => {
      actorAs('eg_admin');
      expect((await run('open', 'closed', { technician: null })).message).toContain('service engineer is not assigned');
    });

    it('notifies the raiser, client admins and engineer, and records who closed it', async () => {
      actorAs('client');
      await run('in_progress', 'closed', { body: { reason: 'Working fine now' } });
      const [userIds, title, , excluded] = notifications.pushToUsers.mock.calls[0];
      expect(userIds).toEqual([20, 30, 21]);
      expect(title).toBe('Ticket closed');
      expect(excluded).toBe(5);
      expect(notifications.onTaskStatusUpdated).toHaveBeenCalledWith(expect.objectContaining({ notifyCompany: false }));
      expect(db('task_event').create.mock.calls[0][0].data).toMatchObject({
        task_link: 41,
        event: 'closed',
        actor_link: 5,
        actor_name: 'Asha',
        actor_role: 'client',
        note: 'Working fine now',
      });
    });

    it('records hold reasons and resumes on the timeline', async () => {
      actorAs('technician', 30);
      await run('in_progress', 'hold', { sub: 30, body: { hold: { hold_reason: 'spare_required', reason: 'Compressor' } } });
      expect(db('task_event').create.mock.calls[0][0].data).toMatchObject({ event: 'hold', note: 'Spare Required · Compressor' });
      await run('hold', 'in_progress', { sub: 30 });
      expect(db('task_event').create.mock.calls[1][0].data).toMatchObject({ event: 'resumed' });
      expect(notifications.pushToUsers).not.toHaveBeenCalled();
    });
  });

  describe('getTaskTimeline', () => {
    const timeline = async (body) => {
      const res = mockRes();
      await service.getTaskTimeline(res, { user: { phone: 'p' }, body });
      return sent(res);
    };
    const actorAs = (access_level: string, companies: number[] = []) =>
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 5,
        name: 'Asha',
        access_level,
        company_user: companies.map((company_link) => ({ company_link })),
      } as any);

    it('returns events oldest first to people who can see the ticket', async () => {
      actorAs('client', [3]);
      db('tasks').findUnique.mockResolvedValue({ deleted_at: null, equipment: { company_link: 3 }, task_user: [{ technician_link: 30 }] });
      db('task_event').findMany.mockResolvedValue([{ id: 1, event: 'raised' }]);
      expect(await timeline({ task_link: 41 })).toEqual({ status: 200, data: [{ id: 1, event: 'raised' }] });
      expect(db('task_event').findMany.mock.calls[0][0]).toMatchObject({
        where: { task_link: 41 },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      });
    });

    it('hides other companies, unassigned engineers and deleted tickets', async () => {
      actorAs('client', [9]);
      db('tasks').findUnique.mockResolvedValue({ deleted_at: null, equipment: { company_link: 3 }, task_user: [{ technician_link: 30 }] });
      expect((await timeline({ task_link: 41 })).status).toBe(403);
      actorAs('technician');
      expect((await timeline({ task_link: 41 })).status).toBe(403);
      actorAs('client', [3]);
      db('tasks').findUnique.mockResolvedValue({ deleted_at: new Date(), equipment: { company_link: 3 }, task_user: [] });
      expect((await timeline({ task_link: 41 })).status).toBe(204);
      expect(db('task_event').findMany).not.toHaveBeenCalled();
    });
  });

  describe('updateTaskFeedback on an individual task', () => {
    it('skips the equipment lookup and still notifies', async () => {
      const task = { id: 41, ticket_no: 'T-1', equipment_link: null };
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 5, name: 'Admin', access_level: 'eg_admin', company_user: [] } as any);
      db('tasks').findUnique.mockResolvedValue(task);
      db('tasks').update.mockResolvedValue(task);
      const res = mockRes();
      await service.updateTaskFeedback(res, { user: { phone: 'p' }, body: { task_link: 41, action_taken: 'Gas refilled' } });
      expect(sent(res)).toMatchObject({ status: 200, message: 'task updated successfully' });
      expect(db('equipment').findUnique).not.toHaveBeenCalled();
      expect(notifications.onTaskNotesUpdated).toHaveBeenCalledWith(expect.objectContaining({ equipment: null, companyLink: undefined }));
    });
  });

  describe('buildServiceReportView for an individual task', () => {
    const task = {
      id: 41,
      ticket_no: 'T-1',
      name: 'AC not cooling',
      description: 'Split AC',
      call_type: 'breakdown',
      equipment: null,
      equipment_link: null,
      contact_name: 'Ravi',
      contact_phone: '+919876543210',
      address: '12 MG Road',
      created_at: new Date('2026-10-01T10:00:00Z'),
      task_user: [{ id: 9, technician_link: 7, client_link: 5, status: 'completed', created_at: new Date('2026-10-01T10:00:00Z'), updated_at: new Date('2026-10-01T12:00:00Z') }],
      hold_reason: [],
      image: [],
    };

    it('uses the contact and address in place of company and client', async () => {
      db('tasks').findUnique.mockResolvedValue(task);
      db('user').findMany.mockResolvedValue([{ id: 7, name: 'Suresh', phone: '9000000007' }, { id: 5, name: 'Admin', phone: '9000000005' }]);
      const view: any = await service.buildServiceReportView(41, { id: 5, access_level: 'eg_admin', company_user: [] });
      expect(view.error).toBeUndefined();
      expect(view.company).toMatchObject({ name: 'Ravi', location: '12 MG Road', address: '12 MG Road' });
      expect(view.contact).toMatchObject({ name: 'Ravi', phone: '+919876543210' });
      expect(view.technician).toMatchObject({ name: 'Suresh', note: 'Assigned service engineer' });
      expect(view.equipment.name).toBeUndefined();
    });

    it('refuses client admins', async () => {
      db('tasks').findUnique.mockResolvedValue(task);
      const view: any = await service.buildServiceReportView(41, { id: 3, access_level: 'client_admin', company_user: [{ company_link: 3 }] });
      expect(view.error).toMatchObject({ status: 403 });
    });

    it('still requires a contact name', async () => {
      db('tasks').findUnique.mockResolvedValue({ ...task, contact_name: null });
      const view: any = await service.buildServiceReportView(41, { id: 5, access_level: 'eg_admin', company_user: [] });
      expect(view.error).toEqual({ status: 422, message: 'A report requires a ticket number and contact name on the task' });
    });
  });
});

describe('UserService bulk uploads and TM frequency', () => {
  let service: UserService;
  const ExcelJS = require('exceljs');
  const asUser = (access_level: string) =>
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 1, name: 'U', phone: 'p', access_level, company_user: [{ company_link: 3 }] } as any);

  beforeEach(async () => {
    for (const key of Object.keys(mockPrisma)) delete mockPrisma[key];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: FirebaseService, useValue: {} },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
  });

  const equipmentSheet = async (frequencies: string[]) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Equipment');
    sheet.addRow(['Name', 'Make', 'Model', 'TM Frequency']);
    frequencies.forEach((frequency, index) => sheet.addRow([`AC ${index}`, 'LG', `M${index}`, frequency]));
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
  };

  it('refuses non-admins before reading the file', async () => {
    const uploads = ['uploadCompanyData', 'uploadEquipmentData', 'uploadTechnicianData'];
    for (const level of ['client', 'client_admin', 'technician', 'others']) {
      for (const upload of uploads) {
        asUser(level);
        const loadRows = jest.spyOn(service as any, 'loadExcelRows');
        const res = mockRes();
        await (service as any)[upload](res, { user: { phone: 'p' }, body: { company_link: 3 } }, { buffer: Buffer.from('x') });
        expect(sent(res)).toEqual({ status: 403, message: 'Only admins can bulk upload' });
        expect(loadRows).not.toHaveBeenCalled();
      }
    }
    expect(db('company').findUnique).not.toHaveBeenCalled();
    expect(db('user').create).not.toHaveBeenCalled();
    expect(db('equipment').create).not.toHaveBeenCalled();
  });

  it('lets admins through to file handling', async () => {
    for (const level of ['eg_admin', 'eg_super_admin']) {
      asUser(level);
      const res = mockRes();
      await service.uploadTechnicianData(res, { user: { phone: 'p' }, body: {} }, null);
      expect(sent(res)).toEqual({ status: 409, message: 'No Excel file received' });
    }
  });

  it('normalizes TM frequency labels and aliases', () => {
    const cases: Record<string, string> = {
      Daily: 'daily',
      ' WEEKLY ': 'weekly',
      'Bi Weekly': 'biweekly',
      'bi-weekly': 'biweekly',
      biweekly: 'biweekly',
      Monthly: 'monthly',
      'Bi-Monthly': 'bi_monthly',
      'bi monthly': 'bi_monthly',
      'Tri-Monthly': 'tri_monthly',
      Quarterly: 'quarterly',
      'Semi Annual': 'semi_annual',
      semi_annual: 'semi_annual',
      'Half Yearly': 'semi_annual',
      half_yearly: 'semi_annual',
      'half-yearly': 'semi_annual',
      Yearly: 'annual',
      Annual: 'annual',
    };
    for (const [input, expected] of Object.entries(cases)) {
      expect(service.normalizeTmFrequency(input)).toBe(expected);
    }
    for (const input of ['Sometimes', 'hourly', '', null, undefined]) {
      expect(service.normalizeTmFrequency(input)).toBeNull();
    }
  });

  it('uploads equipment with normalized frequencies and reports unknown ones per row', async () => {
    asUser('eg_admin');
    db('company').findUnique.mockResolvedValue({ id: 3 });
    const file = await equipmentSheet(['Quarterly', 'Bi-Monthly', 'Sometimes', 'half yearly', '']);
    const res = mockRes();
    await service.uploadEquipmentData(res, { user: { phone: 'p' }, body: { company_link: '3' } }, file);
    const out = sent(res);
    expect(out).toMatchObject({ status: 200, added: 4, skipped: 0, message: 'Added 4 equipment. 1 rows had errors' });
    expect(out.errors).toEqual([
      'Row 4: tm_frequency must be daily, weekly, biweekly, monthly, bi_monthly, tri_monthly, quarterly, semi_annual or annual (got "Sometimes")',
    ]);
    expect(db('equipment').create.mock.calls.map((call) => call[0].data.tm_frequency)).toEqual([
      'quarterly',
      'bi_monthly',
      'semi_annual',
      undefined,
    ]);
  });

  it('validates tm_frequency on createEquipment', async () => {
    asUser('eg_admin');
    db('company').findUnique.mockResolvedValue({ id: 3 });
    db('equipment').create.mockResolvedValue({ id: 8, name: 'AC' });
    const bad = mockRes();
    await service.createEquipment(bad, { user: { phone: 'p' }, body: { company_link: 3, name: 'AC', tm_frequency: 'Sometimes' } });
    expect(sent(bad)).toEqual({
      status: 400,
      message: 'tm_frequency must be daily, weekly, biweekly, monthly, bi_monthly, tri_monthly, quarterly, semi_annual or annual',
    });
    expect(db('equipment').create).not.toHaveBeenCalled();

    const ok = mockRes();
    await service.createEquipment(ok, { user: { phone: 'p' }, body: { company_link: 3, name: 'AC', tm_frequency: 'Half Yearly' } });
    expect(sent(ok)).toMatchObject({ status: 200 });
    expect(db('equipment').create.mock.calls[0][0].data.tm_frequency).toBe('semi_annual');
  });

  it('validates tm_frequency on updateEquipment and keeps the saved value when omitted', async () => {
    asUser('eg_admin');
    db('equipment').findUnique.mockResolvedValue({ id: 8, name: 'AC', company_link: 3, status: 'operational', tm_frequency: 'monthly' });
    db('equipment').update.mockResolvedValue({ id: 8, name: 'AC' });
    const bad = mockRes();
    await service.updateEquipment(bad, { user: { phone: 'p' }, body: { equipment_link: 8, tm_frequency: 'fortnight-ish' } });
    expect(sent(bad)).toMatchObject({ status: 400 });
    expect(db('equipment').update).not.toHaveBeenCalled();

    await service.updateEquipment(mockRes(), { user: { phone: 'p' }, body: { equipment_link: 8, tm_frequency: 'Bi-Monthly' } });
    await service.updateEquipment(mockRes(), { user: { phone: 'p' }, body: { equipment_link: 8, name: 'AC 2' } });
    expect(db('equipment').update.mock.calls.map((call) => call[0].data.tm_frequency)).toEqual(['bi_monthly', 'monthly']);
  });
});

describe('UserService password storage', () => {
  let service: UserService;
  let notifications: Record<string, jest.Mock>;
  const ExcelJS = require('exceljs');
  const { isPasswordHash, verifyPassword, hashPassword } = require('../auth/password');
  const asAdmin = () =>
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 1, name: 'Admin', phone: '9000000001', access_level: 'eg_admin', company_user: [] } as any);
  const expectHashOf = async (stored: string, plain: string) => {
    expect(isPasswordHash(stored)).toBe(true);
    expect((await verifyPassword(plain, stored)).ok).toBe(true);
  };
  const echoCreate = (id: number) => jest.fn(async ({ data }) => ({ id, ...data }));
  const sheet = async (header: string[], rows: string[][]) => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Sheet1');
    ws.addRow(header);
    rows.forEach((row) => ws.addRow(row));
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
  };

  beforeEach(async () => {
    for (const key of Object.keys(mockPrisma)) delete mockPrisma[key];
    notifications = {
      sendCredentialsEmail: jest.fn(),
      onNewTechnician: jest.fn(),
      onNewAmc: jest.fn(),
      pushToLevels: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: FirebaseService, useValue: {} },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
  });

  it('createUser stores a hash, emails the typed password and never returns it', async () => {
    asAdmin();
    db('user').create = echoCreate(10);
    const res = mockRes();
    await service.createUser(res, {
      user: { phone: '9000000001' },
      body: { name: 'Suresh', phone: '9876500000', email: 's@example.com', password: 'Tech@123', access_level: 'technician', designation: 'Junior Technician' },
    });
    await expectHashOf(db('user').create.mock.calls[0][0].data.password, 'Tech@123');
    expect(notifications.sendCredentialsEmail.mock.calls[0][0]).toMatchObject({ phone: '9876500000', password: 'Tech@123' });
    expect(sent(res).status).toBe(200);
    expect(sent(res).data).not.toHaveProperty('password');
  });

  it('updateUser hashes a new password and leaves it alone otherwise', async () => {
    asAdmin();
    db('user').findFirst.mockResolvedValue({ id: 10, name: 'Suresh', phone: '9876500000', access_level: 'technician', password: 'old-plain' });
    db('company_user').findMany.mockResolvedValue([]);
    db('user').update = echoCreate(10);
    const res = mockRes();
    await service.updateUser('10', res, { user: { phone: '9000000001' }, body: { password: 'New@1234' } });
    await expectHashOf(db('user').update.mock.calls[0][0].data.password, 'New@1234');
    expect(sent(res).data).not.toHaveProperty('password');

    await service.updateUser('10', mockRes(), { user: { phone: '9000000001' }, body: { name: 'Suresh K' } });
    expect(db('user').update.mock.calls[1][0].data.password).toBeUndefined();
  });

  it('createCompany hashes the client admin password and emails the typed one', async () => {
    asAdmin();
    const tx = {
      company: { create: echoCreate(3) },
      user: { create: echoCreate(11) },
      company_user: { create: jest.fn() },
    };
    mockPrisma.$transaction = jest.fn(async (fn) => fn(tx));
    const res = mockRes();
    await service.createCompany(res, {
      user: { phone: '9000000001' },
      body: {
        company_name: 'Acme', branch_name: 'HQ', company_location: 'Bengaluru', gst_number: '29ABCDE1234F1Z5',
        service_type: 'regular', name: 'Kiran', phone: '9876511111', email: 'k@example.com', password: 'Amc@1234',
      },
    });
    expect(sent(res)).toMatchObject({ status: 200, message: 'company created successfully' });
    await expectHashOf(tx.user.create.mock.calls[0][0].data.password, 'Amc@1234');
    expect(notifications.sendCredentialsEmail.mock.calls[0][0]).toMatchObject({ phone: '9876511111', password: 'Amc@1234' });
    expect(JSON.stringify(sent(res))).not.toContain('password');
  });

  it('updateCompany hashes client admin passwords for both update and create', async () => {
    const req = { user: { phone: '9000000001' }, body: { name: 'Kiran', phone: '9876511111', email: 'k@example.com', password: 'Amc@5678' } };
    const admin = { access_level: 'eg_admin', company_user: [] };
    db('company_user').findFirst.mockResolvedValueOnce({ user_link: 11 }).mockResolvedValueOnce(null);
    const update = await (service as any).planCompanyClientAdmin(req, 3, admin, 'Bengaluru');
    expect(update.kind).toBe('update');
    await expectHashOf(update.data.password, 'Amc@5678');
    const create = await (service as any).planCompanyClientAdmin(req, 3, admin, 'Bengaluru');
    expect(create.kind).toBe('create');
    await expectHashOf(create.data.password, 'Amc@5678');
  });

  it('register stores a hash', async () => {
    db('user').create = echoCreate(12);
    const res = mockRes();
    await service.register(res, { body: { name: 'New', phone: '9876522222', email: 'n@example.com', password: 'Reg@1234' } });
    expect(sent(res).status).toBe(200);
    await expectHashOf(db('user').create.mock.calls[0][0].data.password, 'Reg@1234');
  });

  it('changePassword verifies legacy and hashed current passwords and stores a hash', async () => {
    for (const stored of ['Old@1234', await hashPassword('Old@1234')]) {
      db('user').findUnique.mockResolvedValue({ id: 4, phone: '9876500000', password: stored });
      db('user').update = jest.fn().mockResolvedValue({});
      const res = mockRes();
      await service.changePassword(res, { user: { sub: 4 }, body: { current_password: 'Old@1234', new_password: 'New@1234' } });
      expect(sent(res)).toEqual({ status: 200, message: 'password updated' });
      await expectHashOf(db('user').update.mock.calls[0][0].data.password, 'New@1234');

      const wrong = mockRes();
      await service.changePassword(wrong, { user: { sub: 4 }, body: { current_password: 'old@1234', new_password: 'New@1234' } });
      expect(sent(wrong)).toEqual({ status: 402, message: 'current password is incorrect' });
      expect(db('user').update).toHaveBeenCalledTimes(1);
    }
  });

  it('forgetPassword emails a new temporary password and stores only its hash', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 4, name: 'Ravi', email: 'ravi@example.com', password: 'Current@1' } as any);
    const sendEmail = jest.spyOn(service, 'sendEmail').mockResolvedValue(true);
    const res = mockRes();
    await service.forgetPassword(res, { body: { phone: '9876500000' } });
    expect(sent(res)).toEqual({ message: 'Password sent to your registered email id: ravi@example.com', status: 200 });
    const [to, subject, body] = sendEmail.mock.calls[0];
    expect([to, subject]).toEqual(['ravi@example.com', 'Forgot Password']);
    expect(body).not.toContain('Current@1');
    const temporary = body.match(/Your temporary password is: (\S+)/)[1];
    expect(temporary).toMatch(/^[A-Za-z2-9]{10}$/);
    const update = db('user').update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 4 });
    await expectHashOf(update.data.password, temporary);
  });

  it('forgetPassword keeps the current password when the email fails', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 4, name: 'Ravi', email: 'ravi@example.com', password: 'Current@1' } as any);
    jest.spyOn(service, 'sendEmail').mockResolvedValue(false);
    const res = mockRes();
    await service.forgetPassword(res, { body: { phone: '9876500000' } });
    expect(sent(res)).toEqual({ message: 'Password failed sent to your registered email id: ravi@example.com', status: 402 });
    expect(db('user').update).not.toHaveBeenCalled();
  });

  it('uploadTechnicianData stores hashes', async () => {
    asAdmin();
    const file = await sheet(['Name', 'Phone', 'Email', 'Password', 'Designation'], [['Suresh', '9876533333', 's2@example.com', 'Tech@999', 'Senior Service Engineer']]);
    const res = mockRes();
    await service.uploadTechnicianData(res, { user: { phone: '9000000001' }, body: {} }, file);
    expect(sent(res)).toMatchObject({ status: 200, added: 1 });
    await expectHashOf(db('user').create.mock.calls[0][0].data.password, 'Tech@999');
  });

  it('uploadCompanyData stores hashed admin passwords', async () => {
    asAdmin();
    db('user').create = echoCreate(20);
    db('company').create = echoCreate(5);
    const file = await sheet(
      ['Company Name', 'Branch Name', 'Admin Name', 'Admin Phone', 'Admin Email', 'Admin Password', 'Service Type'],
      [['Acme', 'HQ', 'Kiran', '9876544444', 'k2@example.com', 'Amc@999', 'Regular']],
    );
    const res = mockRes();
    await service.uploadCompanyData(res, { user: { phone: '9000000001' }, body: {} }, file);
    expect(sent(res)).toMatchObject({ status: 200, added: 1 });
    await expectHashOf(db('user').create.mock.calls[0][0].data.password, 'Amc@999');
  });
});

describe('NotificationService with individual tasks', () => {
  let notifications: NotificationService;

  beforeEach(() => {
    for (const key of Object.keys(mockPrisma)) delete mockPrisma[key];
    notifications = new NotificationService({ sendNotification: jest.fn() } as any);
  });

  it('labels tasks by company, else by contact and address', () => {
    expect(taskPlaceLabel({ contact_name: 'Ravi', address: '12 MG Road' }, { name: 'Acme' })).toBe('Acme');
    expect(taskPlaceLabel({ contact_name: 'Ravi', address: '12 MG Road' }, null)).toBe('Ravi, 12 MG Road');
    expect(taskPlaceLabel({ contact_name: 'Ravi' })).toBe('Ravi');
    expect(taskPlaceLabel(null, null)).toBe('the customer');
    expect(taskPlaceLines({ contact_name: 'Ravi', contact_phone: '+919876543210', address: '12 MG Road' }, null)).toBe(
      'Customer: Ravi (+919876543210)\nAddress: 12 MG Road',
    );
    expect(taskPlaceLines(null, { name: 'Acme' })).toBe('Company: Acme');
  });

  it('puts contact fields into the push payload', () => {
    expect(notifications.taskPayload({ id: 4, name: 'AC', contact_name: 'Ravi', contact_phone: '+919876543210', address: '12 MG Road', equipment: null })).toMatchObject({
      task_link: '4',
      serial_number: '',
      location: '12 MG Road',
      contact_name: 'Ravi',
      contact_phone: '+919876543210',
      address: '12 MG Road',
    });
  });

  it('never pushes a status update to client levels when the task has no company', async () => {
    const push = jest.spyOn(notifications, 'pushToLevels').mockResolvedValue(undefined);
    await notifications.onTaskStatusUpdated({
      task: { id: 4, name: 'AC' },
      equipment: null,
      companyLink: undefined,
      companyName: 'Ravi',
      statusLabel: 'completed',
      updatedByName: 'Suresh',
      isCompleted: true,
    });
    const levels = push.mock.calls.map((call) => call[0]).flat();
    expect(levels).not.toContain('client');
    expect(levels).not.toContain('client_admin');
    expect(levels).toEqual(expect.arrayContaining(['eg_super_admin', 'eg_admin']));
  });

  it('auto-assigns an overdue individual task and names the contact', async () => {
    db('user').findMany.mockResolvedValue([{ id: 7, name: 'Suresh', phone: '9000000007' }]);
    db('tasks').findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 41, ticket_no: 'T-1', contact_name: 'Ravi', address: '12 MG Road', equipment: null, task_user: [{ id: 9, status: 'open', technician_link: null }] },
      ]);
    db('task_user').updateMany.mockResolvedValue({ count: 1 });
    const assigned = jest.spyOn(notifications, 'onTechnicianAssigned').mockResolvedValue(undefined);
    await notifications.runUnassignedTaskAutoAssignment();
    expect(db('task_user').updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ technician_link: 7 }) }));
    expect(assigned).toHaveBeenCalledWith(
      expect.objectContaining({ equipment: null, companyLink: undefined, companyName: 'Ravi, 12 MG Road', technicianUserId: 7 }),
    );
  });

  it('sends hold alerts for an individual task using the contact', async () => {
    const heldSince = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const task = { id: 41, name: 'AC', description: 'Split AC', contact_name: 'Ravi', contact_phone: '+919876543210', address: '12 MG Road', equipment: null };
    db('task_user').findMany.mockResolvedValue([{ task_link: 41, task }]);
    db('task_user').findFirst.mockResolvedValue({ status: 'hold', technician_link: 7, updated_at: heldSince, created_at: heldSince });
    const pushLevels = jest.spyOn(notifications, 'pushToLevels').mockResolvedValue(undefined);
    jest.spyOn(notifications, 'pushToUsers').mockResolvedValue(undefined);
    const email = jest.spyOn(notifications, 'emailToLevels').mockResolvedValue(undefined);
    await notifications.runHoldAlerts();
    expect(pushLevels.mock.calls[0][3].description).toBe('Task AC at Ravi, 12 MG Road has been on hold for more than 24 hours.');
    expect(email.mock.calls[0][3]).toContain('Customer: Ravi (+919876543210)\nAddress: 12 MG Road');
    expect(email.mock.calls[0][3]).toContain('Location: 12 MG Road');
  });
});
