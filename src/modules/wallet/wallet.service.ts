import {
  Injectable,
  BadRequestException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { TransactionType } from './enums/transaction-type.enum';
import { TransactionStatus } from './enums/transaction-status.enum';
import { Booking } from '../booking/entities/booking.entity';
import { BookingService } from '../booking/booking.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from 'src/common/enums/type.enum';
import { ActivityStatus, BookingStatus } from 'src/common/enums/status.enum';
import { ParkingSlot } from '../parking-lot/entities/parking-slot.entity';
import { SlotStatus } from 'src/common/enums/status.enum';
import { Invoice } from '../payment/entities/invoice.entity';
import { InvoiceStatus } from 'src/common/enums/status.enum';
@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactionRepository: Repository<WalletTransaction>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => BookingService))
    private readonly bookingService: BookingService,
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Lấy thông tin ví theo ID người dùng
   */
  async getWalletByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findOne({
      where: { user_id: userId },
    });
    if (!wallet) {
      throw new BadRequestException('Không tìm thấy ví cho người dùng này');
    }
    return wallet;
  }

  /**
   * Khởi tạo ví mới (Thường gọi khi đăng ký tài khoản thành công)
   */
  async createWallet(userId: string): Promise<Wallet> {
    const newWallet = this.walletRepository.create({ user_id: userId });
    return this.walletRepository.save(newWallet);
  }

  /**
   * Xử lý thanh toán (Trừ tiền ví Khách hàng, chuyển sang ví Chủ bãi)
   */
  async processPayment(
    customerId: string,
    ownerId: string,
    amount: number,
    bookingId: string,
  ): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    // Bắt đầu database transaction (để đảm bảo không thất thoát tiền)
    await queryRunner.startTransaction();

    try {
      // 1. Khóa bảng dữ liệu ví Khách hàng để tránh xung đột (race conditions)
      // Ép kiểu ::uuid bằng cast chuẩn trong PostgreSQL để tránh lỗi string_to_uuid
      const customerWallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.user_id = :userId::uuid', { userId: customerId })
        .setLock('pessimistic_write')
        .getOne();

      if (!customerWallet) {
        throw new BadRequestException('Không tìm thấy ví Khách hàng');
      }

      if (Number(customerWallet.balance) < amount) {
        throw new BadRequestException('Số dư không đủ để thanh toán');
      }

      // 2. Khóa bảng dữ liệu ví Chủ bãi
      const ownerWallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.user_id = :userId::uuid', { userId: ownerId })
        .setLock('pessimistic_write')
        .getOne();

      if (!ownerWallet) {
        throw new BadRequestException('Không tìm thấy ví Chủ bãi');
      }

      // 3. Trừ tiền Khách hàng
      const customerBalanceBefore = Number(customerWallet.balance);
      customerWallet.balance = customerBalanceBefore - amount;
      await queryRunner.manager.save(customerWallet);

      // Ghi lại lịch sử giao dịch Khách hàng
      const customerTx = queryRunner.manager.create(WalletTransaction, {
        wallet_id: customerWallet.id,
        amount: -amount, // Khách hàng bị trừ tiền
        balance_before: customerBalanceBefore,
        balance_after: customerWallet.balance,
        type: TransactionType.PAYMENT,
        status: TransactionStatus.SUCCESS,
        ref_type: 'BOOKING',
        ref_id: bookingId,
      });
      await queryRunner.manager.save(customerTx);

      // 4. Cộng tiền cho Chủ bãi
      const ownerBalanceBefore = Number(ownerWallet.balance);
      ownerWallet.balance = ownerBalanceBefore + amount;
      await queryRunner.manager.save(ownerWallet);

      // Ghi lại lịch sử giao dịch Chủ bãi
      const ownerTx = queryRunner.manager.create(WalletTransaction, {
        wallet_id: ownerWallet.id,
        amount: amount, // Chủ bãi được cộng tiền
        balance_before: ownerBalanceBefore,
        balance_after: ownerWallet.balance,
        type: TransactionType.EARN_PARKING_FEE,
        status: TransactionStatus.SUCCESS,
        ref_type: 'BOOKING',
        ref_id: bookingId,
      });
      await queryRunner.manager.save(ownerTx);

      // Kiểm tra xem bookingId gửi lên có thực sự là một chuỗi số không
      const numericBookingId = parseInt(bookingId, 10);

      if (isNaN(numericBookingId)) {
        // Log ra để kiểm tra xem thực tế nó nhận được giá trị gì (undefined, null, hay "object")
        console.error(
          'LỖI: bookingId nhận được không phải là số hợp lệ:',
          bookingId,
        );
        throw new BadRequestException(
          'Mã đặt chỗ không hợp lệ để xử lý thanh toán.',
        );
      }
      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id: numericBookingId },
        relations: ['slot'], // Quan trọng: phải lấy relation slot
      });

      // Cập nhật trạng thái Booking sang 'confirmed'
      await queryRunner.manager.update(Booking, numericBookingId, {
        status: BookingStatus.CONFIRMED,
      });

      await queryRunner.manager.update(ParkingSlot, booking?.slot.id, {
        status: SlotStatus.OCCUPIED,
      });

      // Tìm xem đã có invoice nào cho booking này chưa
      const existingInvoice = await queryRunner.manager.findOne(Invoice, {
        where: { booking: { id: numericBookingId } },
      });

      if (existingInvoice) {
        const subTotal = Number(existingInvoice.sub_total ?? 0);
        const discountAmount = Number(existingInvoice.discount_amount ?? 0);
        const total = Number(existingInvoice.total ?? 0);

        await queryRunner.manager.update(Invoice, existingInvoice.id, {
          status: InvoiceStatus.PAID,
          sub_total: subTotal > 0 ? subTotal : amount,
          discount_amount: discountAmount,
          total: total > 0 ? total : amount,
        });
      } else {
        // Nếu chưa có thì mới tạo mới
        const newInvoice = queryRunner.manager.create(Invoice, {
          sub_total: amount,
          discount_amount: 0,
          total: amount,
          tax: 0,
          status: InvoiceStatus.PAID,
          booking: { id: numericBookingId } as any,
        });
        await queryRunner.manager.save(newInvoice);
      }

      // Lưu toàn bộ phiên giao dịch nếu mọi thứ thành công
      await queryRunner.commitTransaction();

      // Gửi Email (Gọi sau khi commit thành công)
      this.bookingService.sendEmail(Number(bookingId)).catch((err) => {
        console.error('Lỗi gửi email sau khi thanh toán:', err);
      });

      const booked = await this.dataSource.getRepository(Booking).findOne({
        where: { id: Number(bookingId) },
        relations: [
          'user',
          'user.profile',
          'slot',
          'slot.parkingZone',
          'slot.parkingZone.parkingFloor',
          'slot.parkingZone.parkingFloor.parkingLot',
        ],
      });

      const userName =
        booked?.user?.profile?.name ||
        booked?.user?.email ||
        `user #${booked?.user?.id ?? customerId}`;
      const parkingLotName =
        booked?.slot?.parkingZone?.parkingFloor?.parkingLot?.name || 'bãi xe';

      await this.activityService.logActivity({
        type: ActivityType.PAYMENT_SUCCESS,
        content: `Người dùng ${userName} đã thanh toán booking tại ${parkingLotName}`,
        status: ActivityStatus.SUCCESS,
        userId: booked?.user?.id ?? customerId,
        meta: {
          bookingId,
          amount,
          ownerId,
        },
      });

      return true;
    } catch (error) {
      // Hoàn tác trả lại tiền nếu có bất kỳ lỗi gì
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Giải phóng bộ nhớ kết nối database
      await queryRunner.release();
    }
  }

  /**
   * Nạp tiền vào ví người dùng (Thường gọi qua Callback/IPN của VNPay, Momo)
   */
  async deposit(
    userId: string,
    amount: number,
    refId: string,
  ): Promise<WalletTransaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Khóa bảng dữ liệu ví (chống nạp liên tục / trùng gói)
      // Ép chuẩn ::uuid
      const wallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.user_id = :userId::uuid', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet)
        throw new BadRequestException('Không tìm thấy ví cho người dùng này');

      // 2. Cập nhật số dư
      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + amount;
      wallet.balance = balanceAfter;
      await queryRunner.manager.save(wallet);

      // 3. Ghi lại lịch sử
      const transaction = queryRunner.manager.create(WalletTransaction, {
        wallet_id: wallet.id,
        amount: amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.SUCCESS,
        ref_type: 'VNPAY', // Hoặc loại cổng bạn dùng
        ref_id: refId,
      });
      const savedTx = await queryRunner.manager.save(transaction);

      await this.activityService.logActivity({
        type: ActivityType.WALLET_DEPOSIT,
        content: `Người dùng đã nạp tiền vào ví: +${amount}đ`,
        status: ActivityStatus.SUCCESS,
        userId,
        meta: {
          amount,
          refId,
        },
      });
      await queryRunner.commitTransaction();
      return savedTx;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      await this.activityService.logActivity({
        type: ActivityType.WALLET_DEPOSIT,
        content: `Người dùng đã nạp tiền vào ví nhưng gặp lỗi: ${error.message}`,
        status: ActivityStatus.ERROR,
        userId,
        meta: {
          amount,
          refId,
        },
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Rút tiền từ ví (Thường dành cho Chủ bãi rút doanh thu về Ngân hàng)
   */
  async withdraw(
    userId: string,
    amount: number,
    refId: string,
  ): Promise<WalletTransaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Khóa dữ liệu ví
      const wallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.user_id = :userId::uuid', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet)
        throw new BadRequestException('Không tìm thấy ví cho người dùng này');

      const balanceBefore = Number(wallet.balance);
      if (balanceBefore < amount) {
        throw new BadRequestException(
          'Số dư chưa đủ để thực hiện yêu cầu rút tiền',
        );
      }

      // 2. Ghi nhận giao dịch rút tiền ở trạng thái chờ (không trừ tiền ngay)
      const transaction = queryRunner.manager.create(WalletTransaction, {
        wallet_id: wallet.id,
        amount: -amount,
        balance_before: balanceBefore,
        balance_after: balanceBefore,
        type: TransactionType.WITHDRAW,
        status: TransactionStatus.PENDING, // Chờ Admin kiểm tra và chuyển khoản
        ref_type: 'BANK_TRANSFER',
        ref_id: refId,
      });
      const savedTx = await queryRunner.manager.save(transaction);

      await this.activityService.logActivity({
        type: ActivityType.WALLET_WITHDRAW,
        content: `Người dùng đã yêu cầu rút tiền từ ví: -${amount}đ (chờ xử lý)`,
        status: ActivityStatus.INFO,
        userId,
        meta: {
          amount,
          refId,
        },
      });

      await queryRunner.commitTransaction();

      return savedTx;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      await this.activityService.logActivity({
        type: ActivityType.WALLET_WITHDRAW,
        content: `Người dùng đã yêu cầu rút tiền từ ví nhưng gặp lỗi: ${error.message}`,
        status: ActivityStatus.ERROR,
        userId,
        meta: {
          amount,
          refId,
        },
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Hoàn tiền cho Khách Hàng (Khi hủy lịch đỗ xe)
   */
  async refund(
    userId: string,
    amount: number,
    bookingId: string,
  ): Promise<WalletTransaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Khóa dữ liệu ví Khách hàng
      const wallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.user_id = :userId::uuid', { userId })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet) throw new BadRequestException('Không tìm thấy ví');

      const balanceBefore = Number(wallet.balance);
      wallet.balance = balanceBefore + amount;
      await queryRunner.manager.save(wallet);

      // 2. Ghi lại lịch sử hoàn tiền
      const transaction = queryRunner.manager.create(WalletTransaction, {
        wallet_id: wallet.id,
        amount: amount,
        balance_before: balanceBefore,
        balance_after: wallet.balance,
        type: TransactionType.REFUND,
        status: TransactionStatus.SUCCESS,
        ref_type: 'BOOKING',
        ref_id: bookingId,
      });
      const savedTx = await queryRunner.manager.save(transaction);

      await queryRunner.commitTransaction();
      return savedTx;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Lấy lịch sử biến động số dư của ví
   */
  async getTransactions(userId: string): Promise<WalletTransaction[]> {
    const wallet = await this.getWalletByUserId(userId);
    return (
      this.transactionRepository
        .createQueryBuilder('tx')
        .where('tx.wallet_id = :walletId', { walletId: wallet.id })
        // Theo logic: chưa duyệt thì chưa trừ tiền và KHÔNG hiển thị vào lịch sử giao dịch chung.
        .andWhere('(tx.type != :withdrawType OR tx.status = :successStatus)', {
          withdrawType: TransactionType.WITHDRAW,
          successStatus: TransactionStatus.SUCCESS,
        })
        .orderBy('tx.created_at', 'DESC')
        .getMany()
    );
  }

  // ============== ADMIN: YÊU CẦU RÚT TIỀN ==============

  async getWithdrawRequests(): Promise<WalletTransaction[]> {
    return this.transactionRepository.find({
      where: {
        type: TransactionType.WITHDRAW,
        status: TransactionStatus.PENDING,
      },
      relations: ['wallet', 'wallet.user', 'wallet.user.profile'] as any, // Try to load user profile to display receiver's info
      order: { created_at: 'ASC' },
    });
  }

  async approveWithdrawRequest(
    transactionId: string,
  ): Promise<WalletTransaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transaction = await queryRunner.manager.findOne(WalletTransaction, {
        where: { id: transactionId },
        relations: ['wallet'],
      });

      if (!transaction)
        throw new NotFoundException('Không tìm thấy giao dịch!');
      if (
        transaction.type !== TransactionType.WITHDRAW ||
        transaction.status !== TransactionStatus.PENDING
      ) {
        throw new BadRequestException('Giao dịch không hợp lệ để duyệt!');
      }

      const wallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.id = :walletId', { walletId: transaction.wallet_id })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet) throw new NotFoundException('Không tìm thấy ví trích xuất!');

      const amountToDeduct = Math.abs(Number(transaction.amount));
      const currentBalance = Number(wallet.balance);

      if (currentBalance < amountToDeduct) {
        throw new BadRequestException(
          'Số dư hiện tại không đủ để xác nhận lệnh rút tiền này',
        );
      }

      wallet.balance = currentBalance - amountToDeduct;
      await queryRunner.manager.save(wallet);

      transaction.status = TransactionStatus.SUCCESS;
      transaction.balance_before = currentBalance;
      transaction.balance_after = wallet.balance;
      await queryRunner.manager.save(transaction);

      await this.activityService.logActivity({
        type: ActivityType.WALLET_WITHDRAW,
        content: `Yêu cầu rút tiền ${amountToDeduct}đ đã được xác nhận (Thành công)`,
        status: ActivityStatus.SUCCESS,
        userId: wallet.user_id,
        meta: { transactionId },
      });

      await queryRunner.commitTransaction();
      return transaction;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async rejectWithdrawRequest(
    transactionId: string,
  ): Promise<WalletTransaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transaction = await queryRunner.manager.findOne(WalletTransaction, {
        where: { id: transactionId },
        relations: ['wallet'],
      });

      if (!transaction)
        throw new NotFoundException('Không tìm thấy giao dịch!');
      if (
        transaction.type !== TransactionType.WITHDRAW ||
        transaction.status !== TransactionStatus.PENDING
      ) {
        throw new BadRequestException('Giao dịch không hợp lệ để từ chối!');
      }

      // Khóa ví để hoàn tiền
      const wallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'wallet')
        .where('wallet.id = :walletId', { walletId: transaction.wallet_id })
        .setLock('pessimistic_write')
        .getOne();

      if (!wallet) throw new NotFoundException('Không tìm thấy ví trích xuất!');

      const amountToRefund = Math.abs(Number(transaction.amount));

      // Tương thích ngược: chỉ hoàn tiền nếu giao dịch cũ đã từng trừ tiền ngay khi tạo lệnh.
      const wasDeductedOnCreate =
        Number(transaction.balance_after) < Number(transaction.balance_before);

      if (wasDeductedOnCreate) {
        wallet.balance = Number(wallet.balance) + amountToRefund;
        await queryRunner.manager.save(wallet);
      }

      // Cập nhật trạng thái
      transaction.status = TransactionStatus.FAILED;
      if (!wasDeductedOnCreate) {
        transaction.balance_before = Number(wallet.balance);
        transaction.balance_after = Number(wallet.balance);
      }
      await queryRunner.manager.save(transaction);

      // Thêm 1 Transaction Hoàn lại do huỷ rút tiền để rõ ràng lịch sử (tuỳ chọn, nhưng cập nhật FAILED và refund là đủ)

      await this.activityService.logActivity({
        type: ActivityType.WALLET_WITHDRAW,
        content: wasDeductedOnCreate
          ? `Yêu cầu rút tiền ${amountToRefund}đ đã bị từ chối, đã hoàn lại tiền vào ví`
          : `Yêu cầu rút tiền ${amountToRefund}đ đã bị từ chối, ví không bị trừ tiền`,
        status: ActivityStatus.ERROR,
        userId: wallet.user_id,
        meta: { transactionId },
      });

      await queryRunner.commitTransaction();
      return transaction;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getTransactionById(transactionId: string): Promise<WalletTransaction> {
    const tx = await this.transactionRepository.findOne({
      where: { id: transactionId },
    });
    if (!tx) throw new NotFoundException('Không tìm thấy giao dịch!');
    return tx;
  }

  async complainWithdrawRequest(
    transactionId: string,
    userId: string,
    message?: string,
  ): Promise<{ success: boolean; message: string }> {
    const tx = await this.transactionRepository.findOne({
      where: { id: transactionId },
      relations: ['wallet'],
    });

    if (!tx) throw new NotFoundException('Không tìm thấy giao dịch!');
    if (tx.type !== TransactionType.WITHDRAW) {
      throw new BadRequestException('Chỉ hỗ trợ khiếu nại cho lệnh rút tiền');
    }
    if (tx.wallet?.user_id !== userId) {
      throw new BadRequestException(
        'Bạn không có quyền khiếu nại giao dịch này',
      );
    }

    await this.activityService.logActivity({
      type: ActivityType.WALLET_WITHDRAW,
      content: `Người dùng khiếu nại lệnh rút tiền ${Math.abs(Number(tx.amount))}đ - mã ${transactionId}`,
      status: ActivityStatus.INFO,
      userId,
      meta: {
        transactionId,
        withdrawStatus: tx.status,
        complaintMessage:
          message ||
          'Người dùng yêu cầu admin kiểm tra lệnh rút tiền quá hạn xử lý',
      },
    });

    return {
      success: true,
      message: 'Đã gửi khiếu nại đến admin thành công',
    };
  }
}
