import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationService } from '../notification/notification.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: FirebaseService, useValue: {} },
        { provide: NotificationService, useValue: {} },
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
});
