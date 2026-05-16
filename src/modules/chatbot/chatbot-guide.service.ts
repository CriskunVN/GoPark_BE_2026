import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class ChatbotGuideService {
  private readonly logger = new Logger(ChatbotGuideService.name);
  private cachedGuide: string | null = null;

  getGuide(): string {
    if (this.cachedGuide !== null) return this.cachedGuide;

    const candidates = [
      join(process.cwd(), 'src', 'modules', 'chatbot', 'README.md'),
      join(process.cwd(), 'dist', 'modules', 'chatbot', 'README.md'),
      join(process.cwd(), 'README.md'),
    ];

    const guidePath = candidates.find((path) => existsSync(path));
    if (!guidePath) {
      this.logger.warn('Chatbot markdown guide not found');
      this.cachedGuide = '';
      return this.cachedGuide;
    }

    try {
      const markdownParts = [readFileSync(guidePath, 'utf8')];
      const knowledgebaseDirs = [
        join(process.cwd(), 'src', 'modules', 'chatbot', 'knowledgebase'),
        join(process.cwd(), 'dist', 'modules', 'chatbot', 'knowledgebase'),
      ];

      for (const dir of knowledgebaseDirs) {
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir)
          .filter((file) => file.toLowerCase().endsWith('.md'))
          .sort();
        for (const file of files) {
          const path = join(dir, file);
          markdownParts.push(`\n\n# Knowledgebase: ${file}\n${readFileSync(path, 'utf8')}`);
        }
      }

      this.cachedGuide = markdownParts.join('\n\n---\n\n').slice(0, 24000);
    } catch (error) {
      this.logger.warn(`Cannot read chatbot markdown guide: ${String(error)}`);
      this.cachedGuide = '';
    }

    return this.cachedGuide;
  }
}
