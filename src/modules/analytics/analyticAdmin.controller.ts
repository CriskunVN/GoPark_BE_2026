import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('admin/analytics')
export class AnalyticsAdminController {
  constructor(private readonly analyticAdminService: AnalyticsService) {}

  // Get analytics data stats
  @Get('stats')
  async getAnalytics() {
    return this.analyticAdminService.getAnalyticsStats();
  }
}
