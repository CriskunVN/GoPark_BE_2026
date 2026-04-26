import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      client.join(userId);
      console.log(`[NotificationSocket] Client connected: ${client.id}, User: ${userId}`);
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`[NotificationSocket] Client disconnected: ${client.id}`);
  }

  // Phương thức để các service khác gọi để gửi thông báo realtime
  sendNotificationToUser(userId: string, notification: any) {
    if (this.server) {
      this.server.to(userId).emit('notificationReceived', notification);
    } else {
      console.warn('[NotificationGateway] Server not initialized yet');
    }
  }
}
