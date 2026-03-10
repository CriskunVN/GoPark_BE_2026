import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Định nghĩa cấu trúc Response mong muốn
export interface Response<T> {
  statusCode: number;
  message: string;
  data: T;
}

// Interceptor để tự động chuyển đổi response từ controller về định dạng chuẩn
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();

    return next.handle().pipe(
      map((data) => ({
        statusCode: response.statusCode,
        message: data?.message || 'Thành công',
        // Nếu Controller trả về object có thuộc tính data thì lấy nó, không thì lấy toàn bộ
        data: data?.data ? data.data : data,
      })),
    );
  }
}
