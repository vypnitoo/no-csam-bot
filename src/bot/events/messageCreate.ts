import { Message, Client } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { scanImageQueued } from '../../detection/detectionPipeline';
import { handleUserOffense } from '../handlers/banManager';
import { alertModerators, sendDMAlert, notifyModeratorOfPendingReview } from '../handlers/moderatorAlert';
import { logger, logDetection } from '../../utils/logger';

const prisma = new PrismaClient();

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export async function handleMessageCreate(message: Message, client: Client): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const guildConfig = await prisma.guild.findUnique({ where: { id: message.guild.id } });

  if (!guildConfig || !guildConfig.detectionEnabled) {
    return;
  }

  const imageAttachments = message.attachments.filter(attachment =>
    SUPPORTED_IMAGE_TYPES.some(type => attachment.contentType?.startsWith(type))
  );

  if (imageAttachments.size === 0) {
    return;
  }

  for (const attachment of imageAttachments.values()) {
    try {
      await processImageAttachment(message, attachment.url, guildConfig, client);
    } catch (error) {
      logger.error('Error processing image attachment', {
        error,
        messageId: message.id,
        attachmentUrl: attachment.url,
      });
    }
  }
}

async function processImageAttachment(
  message: Message,
  imageUrl: string,
  guildConfig: any,
  client: Client
): Promise<void> {
  try {
    logger.info('Scanning image', {
      messageId: message.id,
      userId: message.author.id,
      guildId: message.guild!.id,
    });

    const detection = await scanImageQueued(imageUrl);

    await prisma.detection.create({
      data: {
        userId: message.author.id,
        guildId: message.guild!.id,
        channelId: message.channel.id,
        messageId: message.id,
        imageUrl,
        imageHash: detection.hash,
        detectionMethod: detection.method,
        confidenceScore: detection.confidence,
        flagged: detection.flagged,
        actionTaken: detection.flagged ? 'pending' : 'none',
        metadata: JSON.stringify(detection.details),
      },
    });

    if (detection.flagged && !detection.requiresReview) {
      await handleFlaggedContent(message, detection, guildConfig, client);
    } else if (detection.requiresReview) {
      await handleReviewRequired(message, detection);
    } else {
      logger.info('Image passed detection', {
        messageId: message.id,
        confidence: detection.confidence,
      });
    }
  } catch (error) {
    logger.error('Error in image processing', {
      error,
      messageId: message.id,
      imageUrl,
    });
  }
}

async function handleFlaggedContent(
  message: Message,
  detection: any,
  guildConfig: any,
  client: Client
): Promise<void> {
  try {
    if (guildConfig.autoDelete) {
      await message.delete();
      logger.info('Deleted flagged message', { messageId: message.id });
    }

    logDetection({
      userId: message.author.id,
      guildId: message.guild!.id,
      method: detection.method,
      confidence: detection.confidence,
      action: 'deleted',
    });

    await prisma.detection.updateMany({
      where: { messageId: message.id },
      data: { actionTaken: 'deleted' },
    });

    if (guildConfig.autoBan) {
      const banResult = await handleUserOffense(
        message.author.id,
        message.guild!.id,
        `CSAM detection: ${detection.method} (confidence: ${(detection.confidence * 100).toFixed(2)}%)`,
        client
      );

      await prisma.detection.updateMany({
        where: { messageId: message.id },
        data: { actionTaken: `deleted_and_banned_level_${banResult.level}` },
      });

      logger.info('User banned', {
        userId: message.author.id,
        level: banResult.level,
        requiresReview: banResult.requiresModeratorReview,
      });
    }

    await alertModerators(
      message.guild!,
      message.author,
      detection,
      guildConfig.autoBan ? `Deleted and banned (Level ${detection.flagged ? 1 : 2})` : 'Deleted'
    );

    await sendDMAlert(
      message.author,
      'Your message contained content that violates our content policy and has been removed.'
    );
  } catch (error) {
    logger.error('Error handling flagged content', { error, messageId: message.id });
  }
}

async function handleReviewRequired(
  message: Message,
  detection: any
): Promise<void> {
  try {
    await message.react('⚠️');

    const detectionRecord = await prisma.detection.findFirst({
      where: { messageId: message.id },
      orderBy: { createdAt: 'desc' },
    });

    if (detectionRecord) {
      await prisma.moderatorReview.create({
        data: {
          detectionId: detectionRecord.id,
          status: 'pending',
        },
      });

      await notifyModeratorOfPendingReview(
        message.guild!,
        detectionRecord.id,
        message.author.id
      );
    }

    logger.info('Content flagged for review', {
      messageId: message.id,
      confidence: detection.confidence,
    });
  } catch (error) {
    logger.error('Error handling review required', { error, messageId: message.id });
  }
}
