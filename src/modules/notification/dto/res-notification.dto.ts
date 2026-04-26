export class ResNotificationDto {
  id: string;
  title: string;
  content: string;
  type: string;
  isRead: boolean;
  createdAt: Date;

  static mapFromEntity(notification: any, recipient: any): ResNotificationDto {
    const dto = new ResNotificationDto();
    dto.id = notification.id;
    dto.title = notification.title;
    dto.content = notification.content;
    dto.type = notification.type;
    dto.isRead = recipient.is_read;
    dto.createdAt = recipient.createdAt || notification.createdAt;
    return dto;
  }
}
