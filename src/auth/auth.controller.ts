import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { Response, Request } from 'express';
import { apiKeyAuth } from './api_key_auth.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService,
  ) {}

  @apiKeyAuth()
  @Post('signIn')
  async signIn(@Res() res: Response, @Req() req: Request) {
    return await this.authService.signIn(res, req);
  }

  @apiKeyAuth()
  @Post('register')
  async register(@Res() res: Response, @Req() req: Request) {
    return await this.userService.register(res, req);
  }

  @Post('logout')
  async logout(@Res() res: Response, @Req() req) {
    return await this.userService.logout(res, req);
  }

  @Get('me')
  async me(@Res() res: Response, @Req() req) {
    return await this.userService.getMe(res, req);
  }

  @Get('profile')
  async getProfile(@Res() res: Response, @Req() req) {
    return await this.userService.getAllCompanies(res, req);
  }
}
