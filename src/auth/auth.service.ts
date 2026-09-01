import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  private static readonly MOBILE_REGEX = /^(\+\d{1,3}[- ]?)?\d{10}$/;

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}
  async signIn(res, req) {
    try {
      const phone = String(req.body.phone ?? '').trim();
      const password = String(req.body.password ?? '');

      if (!AuthService.MOBILE_REGEX.test(phone)) {
        return res.send({
          message: 'invalid mobile number',
          status: 400,
        });
      }

      const user = await this.userService.findOne(phone);
      if (!user) {
        return res.send({
          message: 'you do not have the access',
          status: 403,
        });
      }

      if (user.password !== password) {
        return res.send({
          message: 'wrong password',
          status: 402,
        });
      }

      const fcmId = req.body.fcm_id;
      const deviceId = req.body.device_id;
      if (fcmId && deviceId) {
        try {
          await this.userService.upsertTokens(fcmId, deviceId, user.id, user.phone);
        } catch (tokenError) {
          console.error('upsertTokens failed during signIn', tokenError);
        }
      }
      const payload = { sub: user.id, username: user.email, phone: user.phone };
      user.password = undefined;
      return res.send({
        data: user,
        message: 'login successful',
        status: 200,
        access_token: await this.jwtService.signAsync(payload),
      });
    } catch (error) {
      console.error('signIn failed', error);
      return res.status(500).send({
        message: error?.message || 'login failed',
        status: 500,
      });
    }
  }
}
