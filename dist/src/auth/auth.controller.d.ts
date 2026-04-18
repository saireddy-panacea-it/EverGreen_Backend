import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { Response, Request } from 'express';
export declare class AuthController {
    private authService;
    private userService;
    constructor(authService: AuthService, userService: UserService);
    signIn(res: Response, req: Request): Promise<any>;
    getProfile(res: Response, req: any): Promise<any>;
}
