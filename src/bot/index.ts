import { Client, GatewayIntentBits, Events, Guild, GuildMember } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { config, validateConfig } from '../config/config';
import { logger } from '../utils/logger';
import { handleMessageCreate } from './events/messageCreate';
import { checkAndEnforceGlobalBan } from './handlers/banManager';

const prisma = new PrismaClient();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  logger.info(`Bot is ready! Logged in as ${c.user.tag}`);
  logger.info(`Connected to ${c.guilds.cache.size} guilds`);

  await syncGuilds();
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleMessageCreate(message, client);
  } catch (error) {
    logger.error('Error in message create handler', { error });
  }
});

client.on(Events.GuildCreate, async (guild: Guild) => {
  logger.info('Bot added to new guild', { guildId: guild.id, guildName: guild.name });

  try {
    await prisma.guild.upsert({
      where: { id: guild.id },
      update: { name: guild.name },
      create: {
        id: guild.id,
        name: guild.name,
        moderatorRoleIds: '',
        detectionEnabled: true,
        autoDelete: true,
        autoBan: true,
      },
    });
  } catch (error) {
    logger.error('Error adding guild to database', { error, guildId: guild.id });
  }
});

client.on(Events.GuildDelete, async (guild: Guild) => {
  logger.info('Bot removed from guild', { guildId: guild.id, guildName: guild.name });
});

client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  try {
    await checkAndEnforceGlobalBan(member.id, member.guild);
  } catch (error) {
    logger.error('Error checking global ban on member join', { error, userId: member.id });
  }
});

client.on(Events.Error, (error) => {
  logger.error('Discord client error', { error });
});

async function syncGuilds(): Promise<void> {
  try {
    const guilds = client.guilds.cache.values();

    for (const guild of guilds) {
      await prisma.guild.upsert({
        where: { id: guild.id },
        update: { name: guild.name },
        create: {
          id: guild.id,
          name: guild.name,
          moderatorRoleIds: '',
          detectionEnabled: true,
          autoDelete: true,
          autoBan: true,
        },
      });
    }

    logger.info('Guild sync complete');
  } catch (error) {
    logger.error('Error syncing guilds', { error });
  }
}

async function gracefulShutdown(): Promise<void> {
  logger.info('Shutting down bot...');

  try {
    await prisma.$disconnect();
    logger.info('Database connection closed');

    client.destroy();
    logger.info('Discord client destroyed');

    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function start(): Promise<void> {
  try {
    validateConfig();

    await prisma.$connect();
    logger.info('Database connected successfully');

    await client.login(config.discord.token);
  } catch (error) {
    logger.error('Failed to start bot', { error });
    process.exit(1);
  }
}

start();
