import { Controller, Post, Body, Param, Get, Patch, UseGuards, Req, ParseIntPipe, UseInterceptors, UploadedFiles, UploadedFile, HttpCode, BadRequestException } from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRoleEnum } from '../../common/enums/role.enum';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Post('upload')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadReviewImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file để upload');
    console.log('[REVIEW UPLOAD] file received:', file?.originalname, file?.size, 'buffer size:', file?.buffer?.length);
    const fileUrl = await this.supabaseService.uploadFile(file, 'reviews');
    console.log('[REVIEW UPLOAD] uploaded URL:', fileUrl);
    return { fileUrl };
  }

  @Post('booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  createReview(
    @Req() req: any,
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @Body() body: { rating: number; comment: string; images?: string[] },
  ) {
    const userId = req.user.userId;
    console.log('[CREATE REVIEW] body received:', JSON.stringify(body));
    return this.reviewsService.createReview(userId, bookingId, {
      rating: Number(body.rating),
      comment: body.comment,
      images: body.images || [],
    });
  }

  @Post(':reviewId/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRoleEnum.OWNER)
  replyToReview(
    @Req() req: any,
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @Body() replyDto: { reply: string },
  ) {
    const ownerId = req.user.userId;
    return this.reviewsService.replyToReview(ownerId, reviewId, replyDto);
  }

  @Get('parking-lot/:lotId')
  getReviewsByLot(@Param('lotId', ParseIntPipe) lotId: number) {
    return this.reviewsService.getReviewsByParkingLot(lotId);
  }

  @Get('booking/:bookingId/check')
  @UseGuards(JwtAuthGuard)
  checkCanReview(
    @Req() req: any,
    @Param('bookingId', ParseIntPipe) bookingId: number,
  ) {
    const userId = req.user.userId;
    return this.reviewsService.checkCanReview(userId, bookingId);
  }

  @Get('booking/:bookingId/review')
  @UseGuards(JwtAuthGuard)
  getReviewByBooking(
    @Req() req: any,
    @Param('bookingId', ParseIntPipe) bookingId: number,
  ) {
    const userId = req.user.userId;
    return this.reviewsService.getReviewByBooking(userId, bookingId);
  }

  @Patch(':reviewId')
  @UseGuards(JwtAuthGuard)
  updateReview(
    @Req() req: any,
    @Param('reviewId', ParseIntPipe) reviewId: number,
    @Body() body: { rating?: number; comment?: string; images?: string[] },
  ) {
    const userId = req.user.userId;
    return this.reviewsService.updateReview(userId, reviewId, body);
  }
}
