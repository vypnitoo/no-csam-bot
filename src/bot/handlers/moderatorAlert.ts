import { Client, EmbedBuilder, TextChannel, Guild, User } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { DetectionResult } from '../../detection/detectionPipeline';

const prisma = new PrismaClient();

export async function alertModerators(
  guild: Guild,
  user: User,
  detection: DetectionResult,
  actionTaken: string
): Promise<void> {
  try {
    const guildConfig = await prisma.guild.findUnique({ where: { id: guild.id } });

    if (!guildConfig || !guildConfig.alertChannelId) {
      logger.warn('No alert channel configured', { guildId: guild.id });
      return;
    }

    const alertChannel = guild.channels.cache.get(guildConfig.alertChannelId) as TextChannel;

    if (!alertChannel) {
      logger.error('Alert channel not found', { channelId: guildConfig.alertChannelId });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Content Detection Alert')
      .setColor(detection.flagged ? 0xFF0000 : 0xFFA500)
      .setTimestamp()
      .addFields(
        { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
        { name: 'Detection Method', value: detection.method, inline: true },
        { name: 'Confidence', value: `${(detection.confidence * 100).toFixed(2)}%`, inline: true },
        { name: 'Action Taken', value: actionTaken, inline: true },
        { name: 'Requires Review', value: detection.requiresReview ? 'Yes' : 'No', inline: true },
        { name: 'Processing Time', value: `${detection.totalProcessingTimeMs}ms`, inline: true }
      )
      .setFooter({ text: 'No CSAM Bot by vypnito' });

    if (detection.requiresReview) {
      embed.setDescription('This detection requires moderator review. Check the dashboard for details.');
    }

    await alertChannel.send({ embeds: [embed] });

    const moderatorRoleIds = guildConfig.moderatorRoleIds.split(',');
    const mentions = moderatorRoleIds.map(id => `<@&${id}>`).join(' ');

    if (detection.flagged && !detection.requiresReview) {
      await alertChannel.send(`${mentions} Immediate action taken on detected content.`);
    } else if (detection.requiresReview) {
      await alertChannel.send(`${mentions} Content flagged for review - please check the dashboard.`);
    }

    logger.info('Moderator alert sent', { guildId: guild.id, userId: user.id });
  } catch (error) {
    logger.error('Error sending moderator alert', { error, guildId: guild.id });
  }
}

export async function sendDMAlert(user: User, reason: string): Promise<void> {
  try {
    const embed = new EmbedBuilder()
      .setTitle('Content Violation Notice')
      .setColor(0xFF0000)
      .setDescription(
        'Your message was removed due to a content policy violation.'
      )
      .addFields(
        { name: 'Reason', value: reason },
        {
          name: 'Appeal',
          value: 'If you believe this was a mistake, please contact the server moderators.',
        }
      )
      .setTimestamp()
      .setFooter({ text: 'No CSAM Bot by vypnito' });

    await user.send({ embeds: [embed] });
    logger.info('DM alert sent to user', { userId: user.id });
  } catch (error) {
    logger.warn('Could not send DM to user', { userId: user.id, error });
  }
}

export async function notifyModeratorOfPendingReview(
  guild: Guild,
  detectionId: string,
  userId: string
): Promise<void> {
  try {
    const guildConfig = await prisma.guild.findUnique({ where: { id: guild.id } });

    if (!guildConfig || !guildConfig.alertChannelId) {
      return;
    }

    const alertChannel = guild.channels.cache.get(guildConfig.alertChannelId) as TextChannel;

    if (!alertChannel) {
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Review Required')
      .setColor(0xFFA500)
      .setDescription('A detection has been flagged for moderator review.')
      .addFields(
        { name: 'Detection ID', value: detectionId, inline: true },
        { name: 'User ID', value: userId, inline: true },
        { name: 'Action', value: 'Please review this detection in the dashboard', inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'No CSAM Bot by vypnito' });

    const moderatorRoleIds = guildConfig.moderatorRoleIds.split(',');
    const mentions = moderatorRoleIds.map(id => `<@&${id}>`).join(' ');

    await alertChannel.send({ content: mentions, embeds: [embed] });

    logger.info('Pending review notification sent', { guildId: guild.id, detectionId });
  } catch (error) {
    logger.error('Error sending pending review notification', { error, guildId: guild.id });
  }
}
