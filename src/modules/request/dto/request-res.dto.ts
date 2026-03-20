import { Request } from '../entities/request.entity';

class RequestRequesterResDto {
  id: string;
  email?: string;
}

export class RequestResDto {
  id: string;
  type: string;
  status: string;
  payload: Record<string, any>;
  description?: string;
  note?: string;
  requesterId?: string;
  requester?: RequestRequesterResDto;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(request: Request): RequestResDto {
    return {
      id: request.id,
      type: request.type,
      status: request.status,
      payload: request.payload,
      description: request.description,
      note: request.note,
      requesterId: request.requester?.id,
      requester: request.requester
        ? {
            id: request.requester.id,
            email: request.requester.email,
          }
        : undefined,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  static fromEntities(requests: Request[]): RequestResDto[] {
    return (requests || []).map((request) => RequestResDto.fromEntity(request));
  }
}
