import {
  Controller,
  Post,
  Body,
  Req,
  Get,
  Query,
  Param,
  Patch,
  ParseIntPipe,
} from '@nestjs/common';
import { VnpayService } from './vnpay.service';
import { WalletService } from '../wallet/wallet.service';
import type { Response } from 'express';
import { PaymentService } from './payment.service';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly vnpayService: VnpayService,
    private readonly walletService: WalletService,
    private readonly paymentService: PaymentService,
  ) {}

  @Post('pricing-rule')
  async createPricingRule(@Body() dto: CreatePricingRuleDto) {
    return await this.paymentService.createPricingRule(dto);
  }

  @Get('pricing-rule/zone/:zoneId')
  async getPricingRuleByZone(@Param('zoneId') zoneId: string) {
    return await this.paymentService.getPricingRuleByZone(+zoneId);
  }

  @Patch('pricing-rule/:parkingLotId/floors/:floorId/zones/:zoneId/rule/:id')
  async updatePricingRule(
    @Param('parkingLotId', ParseIntPipe) parkingLotId: number,
    @Param('floorId', ParseIntPipe) floorId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePricingRuleDto,
  ) {
    return await this.paymentService.updatePricingRule(
      parkingLotId,
      floorId,
      zoneId,
      id,
      dto,
    );
  }

  // API 1: Tạo link VNPAY cho Frontend
  @Post('vnpay/create-url')
  createPaymentUrl(
    @Req() req: any,
    @Body() body: { amount: number; userId: string; bookingId?: number },
  ) {
    // VNPAY thường báo lỗi định dạng nếu IP là ::1, nên ở local ta fix cứng IPv4
    const ipAddr = '127.0.0.1';

    // Validate số tiền
    if (!body.amount || body.amount < 10000) {
      return { success: false, message: 'Số tiền tối thiểu là 10,000 VND' };
    }

    const userId = body.userId || req.user?.id;

    // Xoá khoảng trắng để VNPAY không báo lỗi định dạng
    // Phân loại: PayBooking cho thanh toán giữ chỗ, NapTien cho nạp ví
    const orderInfo = body.bookingId
      ? `PayBooking_${userId}_${body.bookingId}`
      : `NapTien_${userId}`;

    const url = this.vnpayService.createPaymentUrl(
      body.amount,
      ipAddr,
      orderInfo,
      userId,
    );
    console.log(url);
    return { success: true, url };
  }

  // API 2: VNPAY gọi về ngầm để cập nhật tiền (Webhook / IPN)
  @Get('vnpay/ipn')
  async vnpayIpn(@Query() query: any) {
    console.log('--- VNPAY IPN Called ---');
    console.log(query);

    const verifyResult = this.vnpayService.verifyIpn(query);

    if (verifyResult.isSuccess) {
      if (verifyResult.code === '00') {
        try {
          const orderInfo = query['vnp_OrderInfo'];
          const amount = parseInt(query['vnp_Amount']) / 100; // VNPAY trả về x100, chia 100 bằng số tiền gốc
          const refId = query['vnp_TxnRef']; // Mã giao dịch của VNPay

          // Xử lý thanh toán Booking qua VNPAY
          if (orderInfo && orderInfo.startsWith('PayBooking_')) {
            const matched = orderInfo.match(/PayBooking_([\w-]+)_(\d+)/);
            if (matched) {
              const bookingId = parseInt(matched[2]);
              await this.paymentService.handleBookingVnpayPayment(
                bookingId,
                amount,
                query, 
              );
              return { RspCode: '00', Message: 'Confirm Success' };
            }
          }

          // Mặc định nạp tiền vào ví
          const matched = orderInfo.match(/NapTien_([\w-]+)/);
          const userId = matched ? matched[1] : null;

          if (userId) {
            // Xử lý nạp tiền vào ví
            await this.walletService.deposit(userId, amount, `VNPAY_${refId}`);
            return { RspCode: '00', Message: 'Confirm Success' };
          } else {
            return {
              RspCode: '04',
              Message: 'Order not found / UserId missing',
            };
          }
        } catch (error) {
          console.error('Lỗi khi xử lý IPN:', error);
          return { RspCode: '99', Message: 'Unknown error' };
        }
      } else {
        // Code !== 00 tức là thất bại
        const orderInfo = query['vnp_OrderInfo'];
        if (orderInfo && orderInfo.startsWith('PayBooking_')) {
          const matched = orderInfo.match(/PayBooking_([\w-]+)_(\d+)/);
          if (matched) {
            const bookingId = parseInt(matched[2]);
            await this.paymentService.handleBookingVnpayFailure(bookingId);
          }
        }
        return {
          RspCode: '00',
          Message: 'Confirm Success (Failed Transaction)',
        };
      }
    } else {
      return { RspCode: '97', Message: 'Invalid Checksum' };
    }
  }

  // API 3: URL để Frontend hiển thị kết quả về UI (Redirection URL)
  @Get('vnpay/return')
  vnpayReturn(@Query() query: any) {
    const verifyResult = this.vnpayService.verifyIpn(query);
    if (verifyResult.isSuccess) {
      if (verifyResult.code === '00') {
        return { success: true, message: 'Giao dịch thành công', data: query };
      } else {
        return { success: false, message: 'Giao dịch thất bại', data: query };
      }
    } else {
      return { success: false, message: 'Chữ ký không hợp lệ', data: query };
    }
  }

  // GET invoice by booking id
  @Get('invoice/booking/:bookingId')
  async getInvoiceByBooking(@Param('bookingId') bookingId: number) {
    return await this.paymentService.getInvoiceByBooking(bookingId);
  }
}
