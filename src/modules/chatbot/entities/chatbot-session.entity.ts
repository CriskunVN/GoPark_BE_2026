import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('chatbot_sessions')
export class ChatbotSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column({ default: 'Cuộc trò chuyện mới' })
  title: string;

  @Column({ type: 'jsonb', default: '[]' })
  messages: Array<{ role: string; content: string; type?: string; data?: any; timestamp: number }>;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
