import { IsEmail, IsNotEmpty, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsOptional()
  fullName?: string;

  @IsOptional()
  phoneNumber?: string;

  @IsOptional()
  role?: string;

  refreshToken?: string | null;
  verifyToken?: string | null;
  resetPasswordToken?: string | null; // Thêm field này cho reset password
  status?: string; // Thêm cho verify email
}
