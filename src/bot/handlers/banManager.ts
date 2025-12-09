import { PrismaClient } from '@prisma/client';
import { Client, Guild } from 'discord.js';
import { logger, logBan } from '../../utils/logger';

const prisma = new PrismaClient();

export interface BanResult {
  success: boolean;
  level: number;
  requiresModeratorReview: boolean;
  message: string;
}

export async function handleUserOffense(
  userId: string,
  guildId: string,
  reason: string,
  client: Client
): Promise<BanResult> {
  try {
    let user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: userId,
          username: 'Unknown',
          discriminator: '0000',
          offenseCount: 0,
        },
      });
    }

    user = await prisma.user.update({
      where: { id: userId },
      data: { offenseCount: { increment: 1 } },
    });

    if (user.offenseCount === 1) {
      return await executeServerBan(userId, guildId, reason, client);
    } else {
      return await queueForGlobalBan(userId, guildId, reason);
    }
  } catch (error) {
    logger.error('Error handling user offense', { error, userId, guildId });
    throw error;
  }
}

async function executeServerBan(
  userId: string,
  guildId: string,
  reason: string,
  client: Client
): Promise<BanResult> {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.error('Guild not found', { guildId });
      return {
        success: false,
        level: 1,
        requiresModeratorReview: false,
        message: 'Guild not found',
      };
    }

    await guild.members.ban(userId, { reason: `CSAM Detection: ${reason}` });

    await prisma.ban.create({
      data: {
        userId,
        guildId,
        level: 1,
        reason,
        banType: 'server',
        active: true,
      },
    });

    logBan({ userId, guildId, level: 1, reason });

    logger.info('Server ban executed', { userId, guildId });

    return {
      success: true,
      level: 1,
      requiresModeratorReview: false,
      message: 'User banned from server (first offense)',
    };
  } catch (error: any) {
    logger.error('Error executing server ban', { error: error.message, userId, guildId });
    return {
      success: false,
      level: 1,
      requiresModeratorReview: false,
      message: `Ban failed: ${error.message}`,
    };
  }
}

async function queueForGlobalBan(
  userId: string,
  guildId: string,
  reason: string
): Promise<BanResult> {
  try {
    await prisma.ban.create({
      data: {
        userId,
        guildId,
        level: 2,
        reason,
        banType: 'global_pending',
        active: false,
      },
    });

    logger.warn('User queued for global ban review', { userId, guildId });

    return {
      success: true,
      level: 2,
      requiresModeratorReview: true,
      message: 'User queued for global ban (requires moderator approval)',
    };
  } catch (error) {
    logger.error('Error queueing for global ban', { error, userId, guildId });
    throw error;
  }
}

export async function approveGlobalBan(banId: string, moderatorId: string, client: Client): Promise<boolean> {
  try {
    const ban = await prisma.ban.findUnique({
      where: { id: banId },
      include: { user: true },
    });

    if (!ban || ban.banType !== 'global_pending') {
      logger.error('Invalid ban for approval', { banId });
      return false;
    }

    await prisma.ban.update({
      where: { id: banId },
      data: {
        banType: 'global',
        active: true,
      },
    });

    await prisma.user.update({
      where: { id: ban.userId },
      data: { globallyBanned: true },
    });

    const guilds = client.guilds.cache.values();
    let bannedCount = 0;

    for (const guild of guilds) {
      try {
        await guild.members.ban(ban.userId, { reason: 'Global CSAM ban (approved by moderator)' });
        bannedCount++;
      } catch (error) {
        logger.error('Failed to ban user in guild', { guildId: guild.id, userId: ban.userId });
      }
    }

    logger.info('Global ban approved and executed', {
      userId: ban.userId,
      moderatorId,
      guildsAffected: bannedCount,
    });

    return true;
  } catch (error) {
    logger.error('Error approving global ban', { error, banId });
    return false;
  }
}

export async function rejectGlobalBan(banId: string, moderatorId: string, notes: string): Promise<boolean> {
  try {
    await prisma.ban.update({
      where: { id: banId },
      data: {
        banType: 'global_rejected',
        active: false,
      },
    });

    logger.info('Global ban rejected', { banId, moderatorId, notes });
    return true;
  } catch (error) {
    logger.error('Error rejecting global ban', { error, banId });
    return false;
  }
}

export async function checkAndEnforceGlobalBan(userId: string, guild: Guild): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (user && user.globallyBanned) {
      await guild.members.ban(userId, { reason: 'Globally banned user detected' });
      logger.info('Enforced global ban on join', { userId, guildId: guild.id });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('Error checking global ban', { error, userId });
    return false;
  }
}
