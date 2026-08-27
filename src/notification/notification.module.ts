import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationService } from './notification.service';
import { HoldAlertScheduler } from './hold-alert.scheduler';

@Module({
  imports: [FirebaseModule],
  providers: [NotificationService, HoldAlertScheduler],
  exports: [NotificationService],
})
export class NotificationModule {}
