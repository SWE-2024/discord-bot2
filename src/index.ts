import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  Partials,
} from "discord.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN environment variable is required.");
}

if (!OLLAMA_BASE_URL) {
  throw new Error("OLLAMA_BASE_URL environment variable is required.");
}

const MODEL = "huihui-ai/Huihui-Qwen3-Next-80B-A3B-Thinking-abliterated";

const SYSTEM_PROMPT =
  "You are a helpful, friendly Discord bot assistant. Keep your answers concise and clear. If you are unsure about something, say so.";

async function generateReply(userMessage: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
    };
    const reply = data?.message?.content?.trim() ?? "";

    if (!reply) {
      return "Sorry, I couldn't generate a response. Please try again.";
    }

    if (reply.length > 1900) {
      return reply.slice(0, 1900) + "...";
    }

    return reply;
  } catch (error: unknown) {
    console.error("Error calling Ollama API:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return "Could not reach the Ollama server. Make sure it's running and accessible.";
    }
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
  console.log(`Using Ollama model: ${MODEL}`);
  console.log(`Ollama endpoint: ${OLLAMA_BASE_URL}`);
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
    if (typingInterval) clearInterval(typingInterval);
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
