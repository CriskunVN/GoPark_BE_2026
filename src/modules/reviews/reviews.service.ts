import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from '../users/entities/review.entity';
import { Booking } from '../booking/entities/booking.entity';
import { ParkingLot } from '../parking-lot/entities/parking-lot.entity';
import { BookingStatus } from '../../common/enums/status.enum';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(ParkingLot)
    private readonly parkingLotRepository: Repository<ParkingLot>,
  ) {}

  async createReview(
    userId: string,
    bookingId: number,
    createReviewDto: { rating: number; comment: string; images?: string[] },
  ) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
      relations: ['user', 'slot', 'slot.parkingZone', 'slot.parkingZone.parkingFloor', 'slot.parkingZone.parkingFloor.parkingLot'],
    });

    if (!booking) {
      throw new NotFoundException('Không tìm thấy lượt đặt chỗ');
    }

    if (booking.user.id !== userId) {
      throw new ForbiddenException('Bạn không có quyền đánh giá lượt đặt chỗ này');
    }

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('Chỉ có thể đánh giá sau khi đã hoàn tất (checkout) bãi đỗ xe');
    }

    const existingReview = await this.reviewRepository.findOne({
      where: { booking: { id: bookingId } },
    });

    if (existingReview) {
      throw new BadRequestException('Bạn đã đánh giá lượt đặt chỗ này rồi');
    }

    let imageUrls: string[] = [];
    if (Array.isArray(createReviewDto.images)) {
      imageUrls = createReviewDto.images.filter(u => u && u.startsWith('http'));
    }
    console.log('[CREATE REVIEW SERVICE] imageUrls to save:', imageUrls);

    const review = this.reviewRepository.create({
      rating: createReviewDto.rating,
      comment: createReviewDto.comment,
      images: imageUrls,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
      user: booking.user,
      lot: booking.slot?.parkingZone?.parkingFloor?.parkingLot,
      booking: booking,
    });

    return this.reviewRepository.save(review);
  }

  async replyToReview(
    ownerId: string,
    reviewId: number,
    replyDto: { reply: string },
  ) {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
      relations: ['lot', 'lot.owner'],
    });

    if (!review) {
      throw new NotFoundException('Không tìm thấy đánh giá');
    }

    if (review.lot.owner.id !== ownerId) {
      throw new ForbiddenException('Bạn không có quyền trả lời đánh giá này');
    }

    review.owner_reply = replyDto.reply;
    review.owner_reply_at = new Date();
    review.updated_at = new Date();

    return this.reviewRepository.save(review);
  }

  async getReviewsByParkingLot(lotId: number) {
    const reviews = await this.reviewRepository.find({
      where: { lot: { id: lotId }, status: 'active' },
      relations: ['user', 'user.profile'],
      order: { created_at: 'DESC' },
    });

    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      images: r.images,
      created_at: r.created_at,
      updated_at: r.updated_at,
      owner_reply: r.owner_reply,
      owner_reply_at: r.owner_reply_at,
      user: {
        id: r.user.id,
        first_name: r.user.profile?.name?.split(' ')[0] || 'User',
        last_name: r.user.profile?.name?.split(' ').slice(1).join(' ') || '',
        avatar_url: r.user.profile?.image || '',
      },
    }));
  }

  async checkCanReview(userId: string, bookingId: number) {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId },
      relations: ['user'],
    });

    if (!booking) return { canReview: false, reason: 'not_found' };
    if (booking.user.id !== userId) return { canReview: false, reason: 'forbidden' };
    if (booking.status !== BookingStatus.COMPLETED) return { canReview: false, reason: 'not_completed' };

    const existingReview = await this.reviewRepository.findOne({
      where: { booking: { id: bookingId } },
    });

    if (existingReview) return { canReview: false, reason: 'already_reviewed' };

    return { canReview: true };
  }

  async getReviewByBooking(userId: string, bookingId: number) {
    const review = await this.reviewRepository.findOne({
      where: { booking: { id: bookingId } },
      relations: ['user'],
    });

    if (!review) return null;
    if (review.user.id !== userId) throw new ForbiddenException('Không có quyền xem');

    let images = review.images || [];
    if (typeof images === 'string') {
      try { images = JSON.parse(images as any); } catch { images = []; }
    }

    return {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      images,
      created_at: review.created_at,
      owner_reply: review.owner_reply,
      owner_reply_at: review.owner_reply_at,
    };
  }

  async updateReview(
    userId: string,
    reviewId: number,
    body: { rating?: number; comment?: string; images?: string[] },
  ) {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
      relations: ['user'],
    });

    if (!review) throw new NotFoundException('Không tìm thấy đánh giá');
    if (review.user.id !== userId) throw new ForbiddenException('Bạn không có quyền sửa đánh giá này');

    if (body.rating) review.rating = Number(body.rating);
    if (body.comment) review.comment = body.comment;
    if (Array.isArray(body.images)) {
      review.images = body.images.filter(u => u && u.startsWith('http'));
    }
    review.updated_at = new Date();

    return this.reviewRepository.save(review);
  }
}
