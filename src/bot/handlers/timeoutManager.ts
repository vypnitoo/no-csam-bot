import { PrismaClient } from '@prisma/client';
import { Client, Guild } from 'discord.js';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface TimeoutResult {
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
): Promise<TimeoutResult> {
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
      return await executeServerTimeout(userId, guildId, reason, client);
    } else {
      return await queueForReview(userId, guildId, reason);
    }
  } catch (error) {
    logger.error('Error handling user offense', { error, userId, guildId });
    throw error;
  }
}

async function executeServerTimeout(
  userId: string,
  guildId: string,
  reason: string,
  client: Client
): Promise<TimeoutResult> {
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

    const member = await guild.members.fetch(userId);
    if (!member) {
      logger.error('Member not found', { userId, guildId });
      return {
        success: false,
        level: 1,
        requiresModeratorReview: false,
        message: 'Member not found',
      };
    }

    await member.timeout(ONE_WEEK_MS, `CSAM Detection: ${reason}`);

    const expiresAt = new Date(Date.now() + ONE_WEEK_MS);

    await prisma.timeout.create({
      data: {
        userId,
        guildId,
        level: 1,
        reason,
        timeoutType: 'server',
        active: true,
        expiresAt,
      },
    });

    await notifyModerationServer(client, {
      type: 'timeout',
      level: 1,
      userId,
      guildId,
      guildName: guild.name,
      reason,
      expiresAt,
    });

    logger.info('Server timeout executed', { userId, guildId, expiresAt });

    return {
      success: true,
      level: 1,
      requiresModeratorReview: false,
      message: 'User timed out for 1 week (first offense)',
    };
  } catch (error: any) {
    logger.error('Error executing server timeout', { error: error.message, userId, guildId });
    return {
      success: false,
      level: 1,
      requiresModeratorReview: false,
      message: `Timeout failed: ${error.message}`,
    };
  }
}

async function queueForReview(
  userId: string,
  guildId: string,
  reason: string
): Promise<TimeoutResult> {
  try {
    const expiresAt = new Date(Date.now() + ONE_WEEK_MS);

    await prisma.timeout.create({
      data: {
        userId,
        guildId,
        level: 2,
        reason,
        timeoutType: 'pending_review',
        active: false,
        expiresAt,
      },
    });

    const client = (global as any).discordClient;
    if (client) {
      await notifyModerationServer(client, {
        type: 'pending_review',
        level: 2,
        userId,
        guildId,
        guildName: (await client.guilds.fetch(guildId)).name,
        reason: `Second offense - ${reason}`,
      });
    }

    logger.warn('User queued for review - sent to moderation server', { userId, guildId });

    return {
      success: true,
      level: 2,
      requiresModeratorReview: true,
      message: 'User queued for moderator review (second offense on different server)',
    };
  } catch (error) {
    logger.error('Error queueing for review', { error, userId, guildId });
    throw error;
  }
}

export async function notifyModerationServer(
  client: Client,
  data: {
    type: string;
    level: number;
    userId: string;
    guildId: string;
    guildName: string;
    reason: string;
    expiresAt?: Date;
  }
): Promise<void> {
  try {
    const config = await prisma.botConfig.findUnique({ where: { id: 'main' } });

    if (!config || !config.moderationServerId || !config.moderationChannelId) {
      logger.warn('Moderation server not configured');
      return;
    }

    const modGuild = client.guilds.cache.get(config.moderationServerId);
    if (!modGuild) {
      logger.error('Moderation server not found', { serverId: config.moderationServerId });
      return;
    }

    const modChannel = modGuild.channels.cache.get(config.moderationChannelId);
    if (!modChannel || !modChannel.isTextBased()) {
      logger.error('Moderation channel not found', { channelId: config.moderationChannelId });
      return;
    }

    const user = await client.users.fetch(data.userId);

    const embed = {
      title: `Detection Alert - Level ${data.level}`,
      color: data.level === 1 ? 0xFFA500 : 0xFF0000,
      fields: [
        { name: 'Server', value: `${data.guildName} (${data.guildId})`, inline: true },
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Action', value: data.type === 'timeout' ? '⏱️ 1 Week Timeout' : '⚠️ Pending Review', inline: true },
        { name: 'Reason', value: data.reason, inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'No CSAM Bot by vypnito' },
    };

    if (data.expiresAt) {
      embed.fields.push({
        name: 'Expires',
        value: `<t:${Math.floor(data.expiresAt.getTime() / 1000)}:R>`,
        inline: true,
      });
    }

    await modChannel.send({ embeds: [embed] });

    logger.info('Moderation server notified', {
      serverId: config.moderationServerId,
      userId: data.userId,
    });
  } catch (error) {
    logger.error('Error notifying moderation server', { error });
  }
}

export async function approveGlobalBan(userId: string, moderatorId: string, client: Client): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { globallyBanned: true },
    });

    await prisma.timeout.updateMany({
      where: { userId, timeoutType: 'pending_review' },
      data: { timeoutType: 'global_approved', active: true },
    });

    const guilds = client.guilds.cache.values();
    let bannedCount = 0;

    for (const guild of guilds) {
      try {
        await guild.members.ban(userId, { reason: 'Global CSAM ban approved by moderator' });
        bannedCount++;
      } catch (error) {
        logger.error('Failed to ban user in guild', { guildId: guild.id, userId });
      }
    }

    logger.info('Global ban approved and executed', {
      userId,
      moderatorId,
      guildsAffected: bannedCount,
    });

    const config = await prisma.botConfig.findUnique({ where: { id: 'main' } });
    if (config && config.moderationServerId && config.moderationChannelId) {
      const modGuild = client.guilds.cache.get(config.moderationServerId);
      const modChannel = modGuild?.channels.cache.get(config.moderationChannelId);

      if (modChannel && modChannel.isTextBased()) {
        await modChannel.send({
          embeds: [{
            title: '✅ Global Ban Approved',
            color: 0xFF0000,
            fields: [
              { name: 'User ID', value: userId, inline: true },
              { name: 'Moderator', value: `<@${moderatorId}>`, inline: true },
              { name: 'Servers Affected', value: `${bannedCount} servers`, inline: true },
            ],
            timestamp: new Date().toISOString(),
          }],
        });
      }
    }

    return true;
  } catch (error) {
    logger.error('Error approving global ban', { error, userId });
    return false;
  }
}

export async function rejectGlobalBan(userId: string, moderatorId: string, notes: string, client: Client): Promise<boolean> {
  try {
    await prisma.timeout.updateMany({
      where: { userId, timeoutType: 'pending_review' },
      data: { timeoutType: 'global_rejected', active: false },
    });

    logger.info('Global ban rejected', { userId, moderatorId, notes });

    const config = await prisma.botConfig.findUnique({ where: { id: 'main' } });
    if (config && config.moderationServerId && config.moderationChannelId) {
      const modGuild = client.guilds.cache.get(config.moderationServerId);
      const modChannel = modGuild?.channels.cache.get(config.moderationChannelId);

      if (modChannel && modChannel.isTextBased()) {
        await modChannel.send({
          embeds: [{
            title: '❌ Global Ban Rejected',
            color: 0x808080,
            fields: [
              { name: 'User ID', value: userId, inline: true },
              { name: 'Moderator', value: `<@${moderatorId}>`, inline: true },
              { name: 'Notes', value: notes || 'No notes provided', inline: false },
            ],
            timestamp: new Date().toISOString(),
          }],
        });
      }
    }

    return true;
  } catch (error) {
    logger.error('Error rejecting global ban', { error, userId });
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

export async function setModerationServer(serverId: string, channelId: string): Promise<void> {
  try {
    await prisma.botConfig.upsert({
      where: { id: 'main' },
      update: {
        moderationServerId: serverId,
        moderationChannelId: channelId,
      },
      create: {
        id: 'main',
        moderationServerId: serverId,
        moderationChannelId: channelId,
      },
    });

    logger.info('Moderation server configured', { serverId, channelId });
  } catch (error) {
    logger.error('Error setting moderation server', { error });
    throw error;
  }
}
