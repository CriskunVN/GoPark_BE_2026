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
  count?: number;
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
      map((rawData: any) => {
        // Trường hợp service trả về object có message nhưng không có data
        // -> đưa message ra ngoài và loại message khỏi data để tránh bị lặp
        if (
          rawData &&
          typeof rawData === 'object' &&
          'message' in rawData &&
          !('data' in rawData)
        ) {
          const { message, ...rest } = rawData;
          return {
            statusCode: response.statusCode,
            message: message || 'Thành công',
            data: Object.keys(rest).length ? rest : {},
          };
        }

        // Nếu đã trả về đúng format custom (success + data), giữ nguyên
        if (
          rawData &&
          typeof rawData === 'object' &&
          'success' in rawData &&
          'data' in rawData
        ) {
          return rawData;
        }

        const isWrappedResponse =
          rawData && typeof rawData === 'object' && 'data' in rawData;

        // Nếu Controller trả về object có thuộc tính data thì lấy nó, không thì lấy toàn bộ
        const payload = isWrappedResponse ? rawData.data : rawData;

        const count =
          (isWrappedResponse && typeof rawData.count === 'number'
            ? rawData.count
            : undefined) ??
          (Array.isArray(payload) ? payload.length : undefined);

        return {
          statusCode: response.statusCode,
          message:
            (isWrappedResponse ? rawData.message : rawData?.message) ||
            'Thành công',
          data: payload,
          ...(typeof count === 'number' ? { count } : {}),
        };
      }),
    );
  }
}
