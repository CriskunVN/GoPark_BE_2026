import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { Conversation } from './conversation.entity';
import { User } from 'src/modules/users/entities/user.entity';

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  FILE = 'FILE',
}

@Entity('messages')
export class Message extends BaseEntity {
  @ManyToOne(() => Conversation, (conv) => conv.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ name: 'conversation_id' })
  conversationId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender!: User;

  @Column({ name: 'sender_id' })
  senderId!: string;

  @Column({ type: 'text', nullable: true })
  content!: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
  type!: MessageType;

  @Column({ name: 'file_url', type: 'varchar', nullable: true })
  fileUrl!: string;

  @Column({ name: 'file_name', type: 'varchar', nullable: true })
  fileName!: string;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead!: boolean;
}
