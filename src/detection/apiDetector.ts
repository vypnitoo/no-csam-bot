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

export async function detectWithCloudflareWorker(imageUrl: string): Promise<APIDetectionResult> {
  const startTime = Date.now();

  if (!config.detection.workerUrl || !config.detection.workerApiKey) {
    return {
      detected: false,
      confidence: 0,
      provider: 'cloudflare-worker',
      processingTimeMs: Date.now() - startTime,
      error: 'Cloudflare Worker URL or API key not configured',
    };
  }

  try {
    const response = await axios.post(
      config.detection.workerUrl,
      { imageUrl },
      {
        headers: {
          'X-API-Key': config.detection.workerApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const result = response.data;

    logger.info('Cloudflare Worker detection complete', {
      confidence: result.confidence,
      detected: result.detected
    });

    return {
      detected: result.detected,
      confidence: result.confidence,
      provider: 'cloudflare-worker',
      labels: result.labels,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    logger.error('Cloudflare Worker API error', { error: error.message });
    return {
      detected: false,
      confidence: 0,
      provider: 'cloudflare-worker',
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

export async function detectWithAPI(imageUrl: string): Promise<APIDetectionResult> {
  if (config.detection.workerUrl) {
    return await detectWithCloudflareWorker(imageUrl);
  }

  if (config.detection.sightengine) {
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
