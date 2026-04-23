import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateStaffDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @MaxLength(13, { message: 'Mật khẩu không quá 13 ký tự' })
  password: string;

  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  fullName: string;

  @IsOptional()
  phoneNumber?: string;
}
