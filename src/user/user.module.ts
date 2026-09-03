import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationModule } from '../notification/notification.module';
import { ServiceReportService } from '../service_report/service_report.service';

@Module({
  imports: [FirebaseModule, NotificationModule],
  providers: [UserService, ServiceReportService],
  controllers: [UserController],
  exports: [UserService, ServiceReportService],
})
export class UserModule {}
