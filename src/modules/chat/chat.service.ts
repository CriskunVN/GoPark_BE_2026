import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message, MessageType } from './entities/message.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { SupabaseService } from 'src/common/supabase/supabase.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly supabaseService: SupabaseService,
    private readonly dataSource: DataSource,
  ) {}

  private async checkRolePermission(user1Id: string, user2Id: string) {
    const user1 = await this.userRepo.findOneBy({ id: user1Id });
    const user2 = await this.userRepo.findOneBy({ id: user2Id });

    if (!user1 || !user2) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    /* Logic check user roles (user.role needs to be fetched, usually a relation or column).
       Assume role is handled by another entity or directly in User entity if merged */
    // Note: Assuming `User` entity has `roles` relation or string role. 
    // Simplified validation below. In real cases, check `user.role` deeply
    return true;
  }

  private async getConversationForParticipant(
    conversationId: string,
    userId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOneBy({
      id: conversationId,
    });

    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    const isParticipant =
      conversation.user1Id === userId || conversation.user2Id === userId;

    if (!isParticipant) {
      throw new ForbiddenException('Bạn không thuộc cuộc trò chuyện này');
    }

    return conversation;
  }

  async findOrCreateConversation(user1Id: string, user2Id: string): Promise<Conversation> {
    await this.checkRolePermission(user1Id, user2Id);

    return this.dataSource.transaction(async (manager) => {
      const [leftUserId, rightUserId] = [user1Id, user2Id].sort();
      const lockKey = `chat-pair:${leftUserId}:${rightUserId}`;

      // Serialize create/find for same user pair to avoid duplicate conversations.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        lockKey,
      ]);

      const conversationRepo = manager.getRepository(Conversation);
      const messageRepo = manager.getRepository(Message);

      const conversations = await conversationRepo
        .createQueryBuilder('conv')
        .where(
          '(conv.user1_id = :user1Id AND conv.user2_id = :user2Id) OR (conv.user1_id = :user2Id AND conv.user2_id = :user1Id)',
          { user1Id, user2Id },
        )
        .orderBy('conv.createdAt', 'ASC')
        .getMany();

      let conversation = conversations[0];

      if (conversation && conversations.length > 1) {
        const duplicateConversations = conversations.slice(1);
        const duplicateConversationIds = duplicateConversations.map((c) => c.id);

        const candidates = [conversation, ...duplicateConversations];

        conversation.user1DeletedAt = candidates
          .map((c) => c.user1DeletedAt)
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => b.getTime() - a.getTime())[0] || null;

        conversation.user2DeletedAt = candidates
          .map((c) => c.user2DeletedAt)
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => b.getTime() - a.getTime())[0] || null;

        if (!conversation.pinnedMessageId) {
          conversation.pinnedMessageId =
            candidates.find((c) => c.pinnedMessageId)?.pinnedMessageId || null;
        }

        await conversationRepo.save(conversation);

        await messageRepo
          .createQueryBuilder()
          .update(Message)
          .set({ conversationId: conversation.id })
          .where('conversation_id IN (:...duplicateConversationIds)', {
            duplicateConversationIds,
          })
          .execute();

        await conversationRepo
          .createQueryBuilder()
          .delete()
          .where('id IN (:...duplicateConversationIds)', {
            duplicateConversationIds,
          })
          .execute();
      }

      if (!conversation) {
        conversation = conversationRepo.create({
          user1Id: leftUserId,
          user2Id: rightUserId,
        });
        await conversationRepo.save(conversation);
      }

      return conversation;
    });
  }

  async saveMessage(senderId: string, dto: SendMessageDto) {
    if (!dto.content && !dto.fileUrl) {
      throw new BadRequestException('Tin nhắn phải có nội dung hoặc file đi kèm');
    }

    let conversation: Conversation | null = null;

    if (dto.conversationId) {
      conversation = await this.conversationRepo.findOneBy({ id: dto.conversationId });

      if (!conversation) {
        throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
      }

      const isParticipant =
        conversation.user1Id === senderId || conversation.user2Id === senderId;

      if (!isParticipant) {
        throw new ForbiddenException('Bạn không thuộc cuộc trò chuyện này');
      }
    } else {
      conversation = await this.findOrCreateConversation(senderId, dto.receiverId);
    }
    
    const message = this.messageRepo.create({
      conversationId: conversation.id,
      conversation: { id: conversation.id }, // Dùng obj để tránh TypeORM overwrite null lên JoinColumn
      senderId,
      sender: { id: senderId }, // Dùng obj để tránh TypeORM overwrite null lên JoinColumn
      content: dto.content,
      type: dto.type || (dto.fileUrl ? MessageType.FILE : MessageType.TEXT),
      fileUrl: dto.fileUrl,
      fileName: dto.fileName,
      isRead: false
    });

    return await this.messageRepo.save(message);
  }

  async getConversations(userId: string) {
    const conversations = await this.conversationRepo
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.user1', 'u1')
      .leftJoinAndSelect('conv.user2', 'u2')
      .where('conv.user1_id = :userId OR conv.user2_id = :userId', { userId })
      .orderBy('conv.updatedAt', 'DESC')
      .getMany();

    if (!conversations.length) {
      return [];
    }

    const conversationIds = conversations.map((conversation) => conversation.id);

    const messages = await this.messageRepo
      .createQueryBuilder('msg')
      .where('msg.conversation_id IN (:...conversationIds)', { conversationIds })
      .orderBy('msg.createdAt', 'DESC')
      .getMany();

    const messagesByConversation = new Map<string, Message[]>();
    for (const message of messages) {
      const list = messagesByConversation.get(message.conversationId) || [];
      list.push(message);
      messagesByConversation.set(message.conversationId, list);
    }

    const hydratedConversations = conversations
      .map((conversation) => {
        const allMessages = messagesByConversation.get(conversation.id) || [];
        const deletedAt =
          conversation.user1Id === userId
            ? conversation.user1DeletedAt
            : conversation.user2DeletedAt;

        const visibleMessages = deletedAt
          ? allMessages.filter(
              (message) =>
                new Date(message.createdAt).getTime() >
                new Date(deletedAt).getTime(),
            )
          : allMessages;

        const lastMessage = visibleMessages[0];
        const unreadCount = visibleMessages.filter(
          (message) => message.senderId !== userId && !message.isRead,
        ).length;

        return {
          ...conversation,
          user1Id: conversation.user1?.id || conversation.user1Id,
          user2Id: conversation.user2?.id || conversation.user2Id,
          messages: lastMessage ? [lastMessage] : [],
          unreadCount,
          _visibleAfterDeletedAt: deletedAt,
        };
      })
      .filter(
        (conversation) =>
          conversation.messages.length > 0 || !conversation._visibleAfterDeletedAt,
      )
      .map(({ _visibleAfterDeletedAt, ...conversation }) => conversation);

    const sortedConversations = hydratedConversations.sort((a, b) => {
      const aTime = a.messages[0]?.createdAt
        ? new Date(a.messages[0].createdAt).getTime()
        : 0;
      const bTime = b.messages[0]?.createdAt
        ? new Date(b.messages[0].createdAt).getTime()
        : 0;
      return bTime - aTime;
    });

    // If legacy duplicate conversations still exist in DB, keep only the newest in list.
    const uniqueByPartner = new Map<string, (typeof sortedConversations)[number]>();
    for (const conversation of sortedConversations) {
      const partnerId =
        conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;

      if (!uniqueByPartner.has(partnerId)) {
        uniqueByPartner.set(partnerId, conversation);
      }
    }

    return Array.from(uniqueByPartner.values());
  }

  async getMessagesForUser(userId: string, conversationId: string) {
    const conversation = await this.getConversationForParticipant(
      conversationId,
      userId,
    );

    const deletedAt =
      conversation.user1Id === userId
        ? conversation.user1DeletedAt
        : conversation.user2DeletedAt;

    const messages = await this.messageRepo.find({
      where: {
        conversationId,
        ...(deletedAt ? { createdAt: MoreThan(deletedAt) } : {}),
      },
      relations: ['sender'],
      order: { createdAt: 'ASC' },
    });

    return messages.map(m => ({
      ...m,
      senderId: m.sender?.id || m.senderId,
      conversationId: m.conversationId || conversationId,
    }));
  }

  async markAsRead(conversationId: string, viewerId: string) {
    const conversation = await this.getConversationForParticipant(
      conversationId,
      viewerId,
    );
    const deletedAt =
      conversation.user1Id === viewerId
        ? conversation.user1DeletedAt
        : conversation.user2DeletedAt;

    const query = this.messageRepo
      .createQueryBuilder()
      .update(Message)
      .set({ isRead: true })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('sender_id != :viewerId', { viewerId });

    if (deletedAt) {
      query.andWhere('createdAt > :deletedAt', { deletedAt });
    }

    return await query.execute();
  }

  async pinMessage(
    userId: string,
    conversationId: string,
    messageId: string | null,
  ) {
    const conversation = await this.getConversationForParticipant(
      conversationId,
      userId,
    );

    if (messageId) {
      const message = await this.messageRepo.findOneBy({
        id: messageId,
        conversationId,
      });

      if (!message) {
        throw new NotFoundException(
          'Không tìm thấy tin nhắn trong cuộc trò chuyện này',
        );
      }
    }

    conversation.pinnedMessageId = messageId;
    const savedConversation = await this.conversationRepo.save(conversation);

    return {
      conversationId: savedConversation.id,
      pinnedMessageId: savedConversation.pinnedMessageId,
    };
  }

  async recallMessage(senderId: string, messageId: string) {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });

    if (!message) {
      throw new NotFoundException('Không tìm thấy tin nhắn');
    }

    if (message.senderId !== senderId) {
      throw new ForbiddenException('Bạn chỉ có thể thu hồi tin nhắn của mình');
    }

    if (message.fileUrl) {
      await this.supabaseService.deleteFilesByUrls([message.fileUrl]);
    }

    message.content = '[RECALLED]';
    message.type = MessageType.TEXT;
    message.fileUrl = null as any;
    message.fileName = null as any;

    const saved = await this.messageRepo.save(message);

    const partnerId =
      saved.conversation.user1Id === senderId
        ? saved.conversation.user2Id
        : saved.conversation.user1Id;

    return {
      ...saved,
      partnerId,
    };
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conversation = await this.getConversationForParticipant(
      conversationId,
      userId,
    );
    const now = new Date();

    if (conversation.user1Id === userId) {
      conversation.user1DeletedAt = now;
    } else {
      conversation.user2DeletedAt = now;
    }

    await this.conversationRepo.save(conversation);

    return {
      conversationId,
      deletedForUserId: userId,
      deletedAt: now,
    };
  }
}
