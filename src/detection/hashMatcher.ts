// @ts-ignore - imghash has no type definitions
import { hash } from 'imghash';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface HashMatchResult {
  matched: boolean;
  hash: string;
  matchedHash?: string;
  similarity?: number;
  processingTimeMs: number;
}

export async function computePerceptualHash(imageBuffer: Buffer): Promise<string> {
  try {
    const imageHash = await hash(imageBuffer, 16);
    return imageHash;
  } catch (error) {
    logger.error('Error computing perceptual hash', { error });
    throw new Error('Failed to compute perceptual hash');
  }
}

export async function checkHashMatch(imageBuffer: Buffer): Promise<HashMatchResult> {
  const startTime = Date.now();

  try {
    const hash = await computePerceptualHash(imageBuffer);

    const knownHashes = await prisma.hashDatabase.findMany({
      where: { active: true },
      select: { hash: true, severity: true },
    });

    for (const knownHash of knownHashes) {
      const similarity = calculateHammingDistance(hash, knownHash.hash);

      if (similarity >= 0.95) {
        logger.info('Hash match found', { similarity, severity: knownHash.severity });
        return {
          matched: true,
          hash,
          matchedHash: knownHash.hash,
          similarity,
          processingTimeMs: Date.now() - startTime,
        };
      }
    }

    return {
      matched: false,
      hash,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Error in hash matching', { error });
    throw error;
  }
}

function calculateHammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    return 0;
  }

  let matches = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] === hash2[i]) {
      matches++;
    }
  }

  return matches / hash1.length;
}

export async function addKnownHash(hash: string, source: string, severity: 'low' | 'medium' | 'high' = 'high'): Promise<void> {
  try {
    await prisma.hashDatabase.create({
      data: {
        hash,
        hashType: 'perceptual',
        source,
        severity,
        active: true,
      },
    });
    logger.info('Added new hash to database', { source, severity });
  } catch (error) {
    logger.error('Error adding hash to database', { error });
    throw error;
  }
}

export async function removeHash(hash: string): Promise<void> {
  try {
    await prisma.hashDatabase.updateMany({
      where: { hash },
      data: { active: false },
    });
    logger.info('Deactivated hash in database', { hash: hash.substring(0, 8) + '...' });
  } catch (error) {
    logger.error('Error removing hash from database', { error });
    throw error;
  }
}
