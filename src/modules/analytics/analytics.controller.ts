import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('owner/:ownerId/dashboard-summary')
  async getOwnerDashboardSummary(@Param('ownerId', ParseUUIDPipe) ownerId: string) {
    return this.analyticsService.getDashboardSummary(ownerId);
  }
}
