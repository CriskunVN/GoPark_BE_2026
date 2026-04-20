import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      client.join(userId);
      console.log(`[Socket] Client connected: ${client.id}, User: ${userId}`);
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`[Socket] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageDto,
  ) {
    const senderId = client.handshake.query.userId as string;

    if (!senderId) {
      return { status: 401, message: 'Unauthorized WebSocket Request' };
    }

    try {
      // 1. Lưu DB
      const originalMessage = await this.chatService.saveMessage(
        senderId,
        payload,
      );
      console.log(
        '[DEBUG] Message saved to DB',
        JSON.stringify(originalMessage),
      );

      const payloadOut = {
        ...originalMessage,
        conversationId: originalMessage.conversationId,
        senderId,
      };

      // 2. Ép kiểu Realtime Notification về phía Receiver (Phòng Socket là `receiverId`)
      this.server.to(payload.receiverId).emit('receiveMessage', payloadOut);

      // 3. Cũng emit về cho bản thân người tạo để update state (tuỳ chọn)
      client.emit('receiveMessage', payloadOut);

      return { status: 200, message: 'Sent' };
    } catch (e: any) {
      client.emit('error', { message: e.message });
      return { status: 400, message: e.message };
    }
  }

  @SubscribeMessage('markRead')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; partnerId?: string },
  ) {
    const viewerId = client.handshake.query.userId as string;
    if (viewerId && payload.conversationId) {
      await this.chatService.markAsRead(payload.conversationId, viewerId);

      // Thông báo đã đọc cho người bạn chat
      if (payload.partnerId) {
        this.server.to(payload.partnerId).emit('messagesRead', {
          conversationId: payload.conversationId,
          readerId: viewerId,
        });
      }
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { receiverId: string; conversationId?: string },
  ) {
    const senderId = client.handshake.query.userId as string;
    this.server
      .to(payload.receiverId)
      .emit('typing', { conversationId: payload.conversationId, senderId });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { receiverId: string; conversationId?: string },
  ) {
    const senderId = client.handshake.query.userId as string;
    this.server
      .to(payload.receiverId)
      .emit('stopTyping', { conversationId: payload.conversationId, senderId });
  }

  @SubscribeMessage('recallMessage')
  async handleRecallMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string },
  ) {
    const senderId = client.handshake.query.userId as string;

    if (!senderId) {
      return { status: 401, message: 'Unauthorized WebSocket Request' };
    }

    try {
      const recalledMessage = await this.chatService.recallMessage(
        senderId,
        payload.messageId,
      );

      const payloadOut = {
        id: recalledMessage.id,
        conversationId: recalledMessage.conversationId,
        senderId: recalledMessage.senderId,
        content: recalledMessage.content,
        type: recalledMessage.type,
        fileUrl: recalledMessage.fileUrl,
        fileName: recalledMessage.fileName,
        createdAt: recalledMessage.createdAt,
      };

      client.emit('messageRecalled', payloadOut);
      this.server.to(recalledMessage.partnerId).emit('messageRecalled', payloadOut);

      return { status: 200, message: 'Recalled' };
    } catch (e: any) {
      client.emit('error', { message: e.message });
      return { status: 400, message: e.message };
    }
  }
}
