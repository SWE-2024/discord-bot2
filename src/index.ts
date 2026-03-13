import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  Partials,
} from "discord.js";
import Replicate from "replicate";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN environment variable is required.");
}

if (!REPLICATE_API_TOKEN) {
  throw new Error("REPLICATE_API_TOKEN environment variable is required.");
}

const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

const MODEL = "xai/grok-4";

const SYSTEM_PROMPT =
  "You are a helpful, friendly Discord bot assistant. Keep your answers concise and clear. If you are unsure about something, say so.";

async function generateReply(userMessage: string): Promise<string> {
  try {
    let reply = "";

    for await (const event of replicate.stream(MODEL, {
      input: {
        prompt: userMessage,
        system_prompt: SYSTEM_PROMPT,
      },
    })) {
      reply += `${event}`;
    }

    reply = reply.trim();

    if (!reply) {
      return "Sorry, I couldn't generate a response. Please try again.";
    }

    if (reply.length > 1900) {
      reply = reply.slice(0, 1900) + "...";
    }

    return reply;
  } catch (error: unknown) {
    console.error("Error calling Replicate API:", error);
    return "Sorry, I ran into an error generating a response. Please try again later.";
  }
}

const processedMessages = new Set<string>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot logged in as: ${readyClient.user.tag}`);
  console.log(`Using Replicate model: ${MODEL}`);
  console.log("Bot is ready! Use ! before your message or DM the bot.");
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const isMentioned = client.user && message.mentions.has(client.user);
  const isDM = !message.guild;
  const isPrefixed = message.content.startsWith("!");

  if (!isMentioned && !isDM && !isPrefixed) return;

  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 60_000);

  let userMessage = message.content;

  if (isPrefixed) {
    userMessage = userMessage.slice(1).trim();
  } else if (client.user) {
    userMessage = userMessage
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();
  }

  if (!userMessage) {
    await message.reply(
      "Hey! I'm your AI assistant. Ask me anything using ! before your message!",
    );
    return;
  }

  console.log(
    `[${message.author.tag}] in [${message.guild?.name ?? "DM"}]: ${userMessage}`,
  );

  let typingInterval: ReturnType<typeof setInterval> | null = null;
  try {
    await message.channel.sendTyping();
    typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8000);

    const reply = await generateReply(userMessage);

    clearInterval(typingInterval);
    typingInterval = null;

    await message.reply(reply);
    console.log(`[Bot replied to ${message.author.tag}]`);
  } catch (error) {
    if (typingInterval) {
      clearInterval(typingInterval);
    }
    console.error("Error handling message:", error);
    await message
      .reply("Something went wrong while processing your request. Please try again!")
      .catch(() => {});
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.on("SIGINT", () => {
  console.log("Shutting down Discord bot...");
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down Discord bot...");
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login to Discord:", err.message);
  process.exit(1);
});
