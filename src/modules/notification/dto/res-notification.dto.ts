export class ResNotificationDto {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;

  static mapFromEntity(entity: any): ResNotificationDto {
    const dto = new ResNotificationDto();
    dto.id = entity.id;
    dto.userId = entity.userId;
    dto.title = entity.title;
    dto.message = entity.message;
    dto.type = entity.type;
    dto.isRead = entity.isRead;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
