import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export interface APIDetectionResult {
  detected: boolean;
  confidence: number;
  provider: string;
  labels?: string[];
  processingTimeMs: number;
  error?: string;
}

export async function detectWithCloudflare(imageBuffer: Buffer): Promise<APIDetectionResult> {
  const startTime = Date.now();

  if (!config.detection.cloudflare) {
    return {
      detected: false,
      confidence: 0,
      provider: 'cloudflare',
      processingTimeMs: Date.now() - startTime,
      error: 'Cloudflare API not configured',
    };
  }

  try {
    const response = await axios.post(
      `https://api.cloudflare.com/client/v4/accounts/${config.detection.cloudflare.accountId}/ai/run/@cf/microsoft/resnet-50`,
      imageBuffer,
      {
        headers: {
          'Authorization': `Bearer ${config.detection.cloudflare.apiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        timeout: 10000,
      }
    );

    const result = response.data.result;
    const nsfwScore = result.find((r: any) => r.label?.toLowerCase().includes('nsfw'))?.score || 0;

    logger.info('Cloudflare detection complete', { nsfwScore });

    return {
      detected: nsfwScore > config.detection.detectionThreshold,
      confidence: nsfwScore,
      provider: 'cloudflare',
      labels: result.map((r: any) => r.label),
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    logger.error('Cloudflare API error', { error: error.message });
    return {
      detected: false,
      confidence: 0,
      provider: 'cloudflare',
      processingTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

export async function detectWithSightengine(imageUrl: string): Promise<APIDetectionResult> {
  const startTime = Date.now();

  if (!config.detection.sightengine) {
    return {
      detected: false,
      confidence: 0,
      provider: 'sightengine',
      processingTimeMs: Date.now() - startTime,
      error: 'Sightengine API not configured',
    };
  }

  try {
    const response = await axios.get('https://api.sightengine.com/1.0/check.json', {
      params: {
        url: imageUrl,
        models: 'nudity-2.1,offensive',
        api_user: config.detection.sightengine.apiUser,
        api_secret: config.detection.sightengine.apiSecret,
      },
      timeout: 10000,
    });

    const data = response.data;
    const nudityScore = data.nudity?.sexual_activity || data.nudity?.sexual_display || 0;
    const offensiveScore = data.offensive?.prob || 0;
    const confidence = Math.max(nudityScore, offensiveScore);

    logger.info('Sightengine detection complete', { confidence });

    return {
      detected: confidence > config.detection.detectionThreshold,
      confidence,
      provider: 'sightengine',
      labels: [],
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    logger.error('Sightengine API error', { error: error.message });
    return {
      detected: false,
      confidence: 0,
      provider: 'sightengine',
      processingTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

export async function detectWithAPI(imageBuffer: Buffer, imageUrl?: string): Promise<APIDetectionResult> {
  if (config.detection.cloudflare) {
    return await detectWithCloudflare(imageBuffer);
  }

  if (config.detection.sightengine && imageUrl) {
    return await detectWithSightengine(imageUrl);
  }

  return {
    detected: false,
    confidence: 0,
    provider: 'none',
    processingTimeMs: 0,
    error: 'No API provider configured',
  };
}
