import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Injectable()
export class HoldAlertScheduler implements OnModuleInit {
  private readonly logger = new Logger(HoldAlertScheduler.name);

  constructor(private readonly notificationService: NotificationService) {}

  onModuleInit() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const schedule = require('node-schedule');
    schedule.scheduleJob('*/15 * * * *', async () => {
      try {
        await this.notificationService.runHoldAlerts();
      } catch (error) {
        this.logger.error(
          `Hold alert job failed: ${error?.message || error}`,
        );
      }
    });
    this.logger.log('Hold alert scheduler started (every 15 minutes)');
    setTimeout(() => {
      this.notificationService.runHoldAlerts().catch((error) => {
        this.logger.error(`Initial hold alert job failed: ${error?.message || error}`);
      });
    }, 15000);
  }
}
