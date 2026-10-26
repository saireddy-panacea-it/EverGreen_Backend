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
