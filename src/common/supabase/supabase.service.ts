import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);
  private readonly bucketName = process.env.SUPABASE_BUCKET || 'img_GoPark2026';

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      this.logger.error('Supabase URL or Key is missing from environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  /**
   * Upload a file to Supabase Storage
   * @param file The file object (e.g., from Multer)
   * @param folder The folder path within the bucket (e.g., 'parkinglot')
   * @returns The public URL of the uploaded image
   */
  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    if (!file) {
      throw new InternalServerErrorException('No file provided for upload');
    }

    try {
      const fileExt = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExt}`;
      const filePath = `${folder}/${fileName}`;

      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (error) {
        this.logger.error(`Error uploading to Supabase: ${error.message}`);
        throw new InternalServerErrorException('Failed to upload image');
      }

      // Generate public URL
      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(filePath);

      return publicUrlData.publicUrl;
    } catch (error) {
      this.logger.error('Unexpected error during file upload:', error);
      throw new InternalServerErrorException('Error processing file upload');
    }
  }
}
