import { Expose } from 'class-transformer';
import {
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  PrimaryColumn,
  Index,
} from 'typeorm';
import { uuidv7 } from 'uuidv7';

export abstract class BaseEntity {
  @PrimaryColumn('uuid')
  @Expose()
  @Index()
  id: string;

  @CreateDateColumn({ type: 'timestamptz' }) // 'timestamptz' là chuẩn cho Postgres (có múi giờ)
  @Expose()
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @Expose()
  updatedAt: Date;

  // 👇 Hook này tự động chạy trước khi lưu vào DB
  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv7();
    }
  }
}
