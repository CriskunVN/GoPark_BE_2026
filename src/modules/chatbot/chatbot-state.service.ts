import { Injectable } from '@nestjs/common';
import NodeCache from 'node-cache';

export interface ChatSession {
  step: 'idle' | 'awaiting_parking_selection' | 'awaiting_booking_details' | 'awaiting_criteria';
  context: any;
  updatedAt: number;
}

@Injectable()
export class ChatbotStateService {
  private cache = new NodeCache({ stdTTL: 600 });

  getSession(userId: string): ChatSession | undefined {
    return this.cache.get<ChatSession>(`chat:${userId}`);
  }

  setSession(userId: string, session: ChatSession): void {
    session.updatedAt = Date.now();
    this.cache.set(`chat:${userId}`, session);
  }

  deleteSession(userId: string): void {
    this.cache.del(`chat:${userId}`);
  }

  updateStep(userId: string, step: ChatSession['step'], contextUpdate: any): void {
    const existing = this.getSession(userId);
    if (existing) {
      existing.step = step;
      existing.context = { ...existing.context, ...contextUpdate };
      this.setSession(userId, existing);
    } else {
      this.setSession(userId, {
        step,
        context: contextUpdate,
        updatedAt: Date.now(),
      });
    }
  }
}