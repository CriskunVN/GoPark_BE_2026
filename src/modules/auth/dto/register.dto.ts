import {
  IsEmail,
  IsNotEmpty,
  MaxLength,
  MinLength,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { UserRoleEnum } from '../../../common/enums/role.enum';

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @MaxLength(13, { message: 'Mật khẩu không quá 13 ký tự' })
  password: string;

  @IsNotEmpty({ message: 'Xác nhận mật khẩu không được để trống' })
  confirmPassword: string;

  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  fullName: string;

  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  phoneNumber: string;
}
