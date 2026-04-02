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

export class UserResDto {
  id: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  roles: string[];
  profile: UserProfileResDto | null;
  vehicles: VehicleResDto[];

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
    };
  }

  static fromEntities(users: User[]): UserResDto[] {
    return (users || []).map((user) => UserResDto.fromEntity(user));
  }
}
