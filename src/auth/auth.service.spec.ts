import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationService } from '../notification/notification.service';
import {
  generateTemporaryPassword,
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from './password';

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

describe('password helpers', () => {
  it('recognises bcrypt hashes only', async () => {
    const hash = await hashPassword('secret1');
    expect(hash).toHaveLength(60);
    expect(isPasswordHash(hash)).toBe(true);
    expect(isPasswordHash(hash.replace(/^\$2[ab]\$/, '$2y$'))).toBe(true);
    for (const value of ['secret1', '$2b$10$short', '', null, undefined, 12345]) {
      expect(isPasswordHash(value)).toBe(false);
    }
  });

  it('verifies hashes and legacy plaintext, flagging plaintext for upgrade', async () => {
    const hash = await hashPassword('secret1');
    expect(await verifyPassword('secret1', hash)).toEqual({ ok: true, needsUpgrade: false });
    expect(await verifyPassword('secret2', hash)).toEqual({ ok: false, needsUpgrade: false });
    expect(await verifyPassword('secret1', 'secret1')).toEqual({ ok: true, needsUpgrade: true });
    expect(await verifyPassword('secret', 'secret1')).toEqual({ ok: false, needsUpgrade: false });
    expect(await verifyPassword('', '')).toEqual({ ok: false, needsUpgrade: false });
    expect(await verifyPassword('x', null)).toEqual({ ok: false, needsUpgrade: false });
  });

  it('generates random temporary passwords within the 6-20 character rule', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const value = generateTemporaryPassword();
      expect(value).toMatch(/^[A-Za-z2-9]{10}$/);
      seen.add(value);
    }
    expect(seen.size).toBe(50);
  });
});

describe('AuthService.signIn', () => {
  let service: AuthService;
  let users: UserService;
  const body = { phone: '9876543210', password: 'secret1' };
  const account = (password: string, extra: Record<string, unknown> = {}) => ({
    id: 4,
    name: 'Ravi',
    phone: '9876543210',
    email: 'ravi@example.com',
    access_level: 'technician',
    is_active: true,
    password,
    company_user: [],
    ...extra,
  });

  beforeEach(async () => {
    for (const key of Object.keys(mockPrisma)) delete mockPrisma[key];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        UserService,
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('jwt-token') } },
        { provide: FirebaseService, useValue: {} },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    users = module.get(UserService);
  });

  it('logs in a legacy plaintext account and re-saves the password as a hash', async () => {
    jest.spyOn(users, 'findOne').mockResolvedValue(account('secret1') as any);
    const res = mockRes();
    await service.signIn(res, { body });
    const out = sent(res);
    expect(out).toMatchObject({ status: 200, message: 'login successful', access_token: 'jwt-token' });
    expect(out.data).not.toHaveProperty('password');
    expect(out.data).toMatchObject({ id: 4, phone: '9876543210' });
    const update = db('user').update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 4 });
    expect(isPasswordHash(update.data.password)).toBe(true);
    expect((await verifyPassword('secret1', update.data.password)).ok).toBe(true);
  });

  it('logs in a hashed account without rewriting it', async () => {
    jest.spyOn(users, 'findOne').mockResolvedValue(account(await hashPassword('secret1')) as any);
    const res = mockRes();
    await service.signIn(res, { body });
    expect(sent(res)).toMatchObject({ status: 200, message: 'login successful' });
    expect(sent(res).data).not.toHaveProperty('password');
    expect(db('user').update).not.toHaveBeenCalled();
  });

  it('rejects a wrong password for legacy and hashed accounts', async () => {
    for (const stored of ['secret1', await hashPassword('secret1')]) {
      jest.spyOn(users, 'findOne').mockResolvedValue(account(stored) as any);
      const res = mockRes();
      await service.signIn(res, { body: { ...body, password: 'Secret1' } });
      expect(sent(res)).toEqual({ message: 'wrong password', status: 402 });
    }
    expect(db('user').update).not.toHaveBeenCalled();
  });

  it('still logs in when the hash upgrade cannot be saved', async () => {
    jest.spyOn(users, 'findOne').mockResolvedValue(account('secret1') as any);
    db('user').update.mockRejectedValue(new Error('value too long for type character varying(20)'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    await service.signIn(res, { body });
    expect(sent(res)).toMatchObject({ status: 200, message: 'login successful' });
  });

  it('keeps the inactive and unknown-user responses', async () => {
    jest.spyOn(users, 'findOne').mockResolvedValue(account(await hashPassword('secret1'), { is_active: false }) as any);
    const inactive = mockRes();
    await service.signIn(inactive, { body });
    expect(sent(inactive)).toEqual({ message: 'Your account is inactive. Contact your administrator.', status: 403 });

    jest.spyOn(users, 'findOne').mockResolvedValue(null);
    const unknown = mockRes();
    await service.signIn(unknown, { body });
    expect(sent(unknown)).toEqual({ message: 'you do not have the access', status: 403 });
  });
});
