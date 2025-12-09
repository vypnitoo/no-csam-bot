import { checkHashMatch, HashMatchResult } from './hashMatcher';
import { detectWithAPI, APIDetectionResult } from './apiDetector';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import axios from 'axios';

export interface DetectionResult {
  flagged: boolean;
  confidence: number;
  method: string;
  requiresReview: boolean;
  hash: string;
  details: {
    hashMatch?: HashMatchResult;
    apiDetection?: APIDetectionResult;
  };
  totalProcessingTimeMs: number;
}

interface QueueItem {
  imageUrl: string;
  imageBuffer: Buffer;
  resolve: (result: DetectionResult) => void;
  reject: (error: Error) => void;
}

class DetectionQueue {
  private queue: QueueItem[] = [];
  private processing = 0;

  async add(imageUrl: string, imageBuffer: Buffer): Promise<DetectionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ imageUrl, imageBuffer, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing >= config.detection.maxConcurrentScans || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.processing++;

    try {
      const result = await scanImage(item.imageBuffer, item.imageUrl);
      item.resolve(result);
    } catch (error) {
      item.reject(error as Error);
    } finally {
      this.processing--;
      this.processNext();
    }
  }
}

const detectionQueue = new DetectionQueue();

export async function scanImageQueued(imageUrl: string): Promise<DetectionResult> {
  const startTime = Date.now();

  try {
    const imageBuffer = await downloadImage(imageUrl);

    const sizeInMB = imageBuffer.length / (1024 * 1024);
    if (sizeInMB > config.detection.imageMaxSizeMB) {
      logger.warn('Image too large', { sizeInMB, maxSize: config.detection.imageMaxSizeMB });
      throw new Error('Image exceeds maximum size limit');
    }

    return await detectionQueue.add(imageUrl, imageBuffer);
  } catch (error) {
    logger.error('Error in queued image scan', { error, imageUrl });
    throw error;
  }
}

async function scanImage(imageBuffer: Buffer, imageUrl: string): Promise<DetectionResult> {
  const startTime = Date.now();

  try {
    const hashResult = await checkHashMatch(imageBuffer);

    if (hashResult.matched) {
      logger.warn('Hash match detected', { similarity: hashResult.similarity });
      return {
        flagged: true,
        confidence: 1.0,
        method: 'hash_match',
        requiresReview: false,
        hash: hashResult.hash,
        details: { hashMatch: hashResult },
        totalProcessingTimeMs: Date.now() - startTime,
      };
    }

    const apiResult = await detectWithAPI(imageBuffer, imageUrl);

    const flagged = apiResult.detected;
    const confidence = apiResult.confidence;
    const requiresReview = confidence >= config.detection.reviewThreshold && confidence < config.detection.detectionThreshold;

    if (flagged) {
      logger.warn('API detection flagged content', { confidence, provider: apiResult.provider });
    }

    return {
      flagged,
      confidence,
      method: apiResult.provider,
      requiresReview,
      hash: hashResult.hash,
      details: {
        hashMatch: hashResult,
        apiDetection: apiResult,
      },
      totalProcessingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Error in image scan', { error });
    throw error;
  }
}

async function downloadImage(url: string): Promise<Buffer> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: config.detection.imageMaxSizeMB * 1024 * 1024,
    });

    return Buffer.from(response.data);
  } catch (error: any) {
    logger.error('Error downloading image', { error: error.message, url });
    throw new Error('Failed to download image');
  }
}

export { downloadImage };
