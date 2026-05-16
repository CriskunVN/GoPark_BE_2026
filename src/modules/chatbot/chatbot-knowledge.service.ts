import { Injectable } from '@nestjs/common';
import { ChatbotGuideService } from './chatbot-guide.service';

type KnowledgeChunk = {
  id: string;
  title: string;
  content: string;
  vector: Map<string, number>;
};

export type KnowledgeMatch = {
  title: string;
  content: string;
  score: number;
};

@Injectable()
export class ChatbotKnowledgeService {
  private chunks: KnowledgeChunk[] | null = null;

  constructor(private readonly guideService: ChatbotGuideService) {}

  search(query: string, limit = 4): KnowledgeMatch[] {
    const queryVector = this.toVector(query);
    if (!queryVector.size) return [];

    return this.getChunks()
      .map((chunk) => ({
        title: chunk.title,
        content: chunk.content,
        score: this.cosineSimilarity(queryVector, chunk.vector),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  buildContext(query: string, limit = 4): string {
    const matches = this.search(query, limit).filter((match) => match.score >= 0.08);
    if (!matches.length) return '';

    return matches
      .map((match, index) => {
        const content = match.content.replace(/\s+/g, ' ').trim().slice(0, 900);
        return `Tai lieu ${index + 1}: ${match.title}\n${content}`;
      })
      .join('\n\n');
  }

  answerFromKnowledge(query: string): string | null {
    const matches = this.search(query, 3).filter((match) => match.score >= 0.12);
    if (!matches.length) return null;

    const bullets = matches
      .map((match) => this.extractBestSentence(match.content, query))
      .filter(Boolean)
      .slice(0, 3);

    if (!bullets.length) return null;
    return [
      'Minh dua theo huong dan hien co cua GoPark:',
      ...bullets.map((line) => `- ${line}`),
      'Neu ban muon thao tac truc tiep nhu dat cho, xem vi, xe, lich su dat hoac doanh thu, minh se goi du lieu he thong.',
    ].join('\n');
  }

  private getChunks(): KnowledgeChunk[] {
    if (this.chunks) return this.chunks;

    const guide = this.guideService.getGuide();
    const sections = guide
      .split(/\n(?=#{1,3}\s+)/)
      .map((section) => section.trim())
      .filter((section) => section.length > 80);

    this.chunks = sections.map((section, index) => {
      const title = section.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || `Knowledge ${index + 1}`;
      const content = section.slice(0, 1800);
      return {
        id: `kb-${index}`,
        title,
        content,
        vector: this.toVector(`${title}\n${content}`),
      };
    });

    return this.chunks;
  }

  private extractBestSentence(content: string, query: string): string {
    const queryVector = this.toVector(query);
    const sentences = content
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/\n|(?<=[.!?])\s+/)
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter((line) => line.length >= 24 && line.length <= 220);

    const best = sentences
      .map((sentence) => ({
        sentence,
        score: this.cosineSimilarity(queryVector, this.toVector(sentence)),
      }))
      .sort((a, b) => b.score - a.score)[0];

    return best?.sentence || content.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  private toVector(value: string): Map<string, number> {
    const vector = new Map<string, number>();
    for (const token of this.tokenize(value)) {
      vector.set(token, (vector.get(token) || 0) + 1);
    }
    return vector;
  }

  private tokenize(value: string): string[] {
    const stopwords = new Set([
      'la', 'va', 'cho', 'cua', 'toi', 'ban', 'minh', 'mot', 'cac', 'nhung',
      'the', 'this', 'that', 'with', 'from', 'can', 'should', 'neu', 'khi',
      'thi', 'hay', 'hoac', 'trong', 'ngoai', 'duoc', 'khong',
    ]);

    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopwords.has(token));
  }

  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const value of a.values()) normA += value * value;
    for (const value of b.values()) normB += value * value;
    if (!normA || !normB) return 0;

    for (const [token, value] of a.entries()) {
      dot += value * (b.get(token) || 0);
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
