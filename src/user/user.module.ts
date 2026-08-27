import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [FirebaseModule, NotificationModule],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
