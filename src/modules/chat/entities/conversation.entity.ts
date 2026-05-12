import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { Message } from './message.entity';

@Entity('conversations')
export class Conversation extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user1_id' })
  user1!: User;

  @Column({ name: 'user1_id' })
  user1Id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user2_id' })
  user2!: User;

  @Column({ name: 'user2_id' })
  user2Id!: string;

  @Column({ name: 'pinned_message_id', type: 'uuid', nullable: true })
  pinnedMessageId!: string | null;

  @Column({ name: 'user1_deleted_at', type: 'timestamptz', nullable: true })
  user1DeletedAt!: Date | null;

  @Column({ name: 'user2_deleted_at', type: 'timestamptz', nullable: true })
  user2DeletedAt!: Date | null;

  @OneToMany(() => Message, (message: Message) => message.conversation)
  messages!: Message[];
}
