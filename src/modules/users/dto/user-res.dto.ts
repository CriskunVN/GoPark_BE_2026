import { User } from '../entities/user.entity';

export class UserProfileResDto {
  id: number;
  name: string;
  phone: string;
  gender: string;
  image: string;
}

export class VehicleResDto {
  id: number;
  plate_number: string;
  image: string;
}

export class BookingResDto {
  id: number;
  status: string;
  qrCode?: any; // Hoặc định nghĩa rõ DTO của QR Code
  vehicle?: any;
  created_at: Date;
}

export class UserResDto {
  id: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  roles: string[];
  profile: UserProfileResDto | null;
  vehicles: VehicleResDto[];
  bookings: BookingResDto[];

  static fromEntity(user: User): UserResDto {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles:
        user.userRoles
          ?.map((userRole) => userRole.role?.name)
          .filter(Boolean) || [],
      profile: user.profile
        ? {
            id: user.profile.id,
            name: user.profile.name,
            phone: user.profile.phone,
            gender: user.profile.gender,
            image: user.profile.image,
          }
        : null,
      vehicles: user.vehicles
        ? user.vehicles.map((v) => ({
            id: v.id,
            plate_number: v.plate_number,
            image: v.image,
          }))
        : [],

      // 2. MAP DỮ LIỆU BOOKINGS TỪ ENTITY SANG DTO
      bookings: user.bookings
        ? user.bookings.map((b) => ({
            id: b.id,
            status: b.status,
            qrCode: b.qrCode, // Đảm bảo relation qrCode đã được load ở findOne
            vehicle: b.vehicle,
            created_at: b.created_at,
          }))
        : [],
    };
  }

  static fromEntities(users: User[]): UserResDto[] {
    return (users || []).map((user) => UserResDto.fromEntity(user));
  }
}
