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

    it('denies everyone else, including unlinked client admins', () => {
      expect(service.auditScopeDecision({ access_level: 'client_admin', companyIds: [] })).toEqual({ scope: 'none' });
      for (const level of ['client', 'technician', 'others']) {
        expect(service.auditScopeDecision({ access_level: level, companyIds: [1] })).toEqual({ scope: 'none' });
      }
      expect(service.auditScopeDecision(null)).toEqual({ scope: 'none' });
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
      expect(normalize('Junior Service Engineer')).toBe('Junior Service Engineer');
      expect(normalize('JUNIOR SERVICE ENGINEER')).toBe('Junior Service Engineer');
    });

    it('maps the legacy Junior Technician input to Junior Service Engineer', () => {
      expect(normalize('Junior Technician')).toBe('Junior Service Engineer');
      expect(normalize(' junior technician ')).toBe('Junior Service Engineer');
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
        message: 'designation must be Senior Service Engineer or Junior Service Engineer',
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
