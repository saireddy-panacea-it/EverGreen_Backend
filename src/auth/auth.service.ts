import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}
  async signIn(res, req) {
    try {
      const user = await this.userService.findOne(req.body.phone);
      if (!user || user.password !== req.body.password) {
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
