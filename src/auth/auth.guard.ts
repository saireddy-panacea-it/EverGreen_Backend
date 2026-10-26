import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { Reflector } from "@nestjs/core";
import { IS_API_KEY, IS_API_KEY_FROM_QUERY } from "./api_key_auth.decorator";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { UserService } from "../user/user.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private userService: UserService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isApiKeyFromQuery = this.reflector.getAllAndOverride<boolean>(
      IS_API_KEY_FROM_QUERY,
      [context.getHandler(), context.getClass()]
    );
    const isApiKey =
      isApiKeyFromQuery ||
      this.reflector.getAllAndOverride<boolean>(IS_API_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    const req = context.switchToHttp().getRequest();
    const apiKey = isApiKeyFromQuery
      ? req.query["api_key"]
      : req.headers["api-key"];

    // console.log(apiKey);
    if (isApiKey && apiKey) {
      const result = apiKey == process.env.NODE_API_KEY;
      return result;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: "jwtConstants.secret",
      });
      // 💡 We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      request["user"] = payload;
    } catch {
      throw new UnauthorizedException();
    }
    // Tokens outlive deactivation (60 days), so inactive accounts are refused per request.
    if (await this.userService.isDeactivated(request["user"]?.sub)) {
      throw new UnauthorizedException("Your account is inactive. Contact your administrator.");
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
