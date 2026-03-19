import { Booking } from '../../booking/entities/booking.entity';

export class ParkingLotUserResDto {
  userId: string;
  name: string;
  email: string;
  phone: string;
  plateNumber: string;

  static fromBookings(bookings: Booking[]): ParkingLotUserResDto[] {
    const userMap = new Map<string, ParkingLotUserResDto>();

    for (const booking of bookings) {
      const { user, vehicle } = booking;
      if (!user || userMap.has(user.id)) continue;

      userMap.set(user.id, {
        userId: user.id,
        name: user.profile?.name ?? '',
        email: user.email,
        phone: user.profile?.phone ?? '',
        plateNumber: vehicle?.plate_number ?? '',
      });
    }

    return Array.from(userMap.values());
  }
}
