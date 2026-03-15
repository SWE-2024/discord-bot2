import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  Partials,
} from "discord.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN environment variable is required.");
}

if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY environment variable is required.");
}

const MODEL = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT =
  "You are a helpful, friendly Discord bot assistant. Keep your answers concise and clear. If you are unsure about something, say so.";

const MAX_HISTORY = 10;

type ChatMessage = { role: "user" | "assistant"; content: string };
const conversationHistory = new Map<string, ChatMessage[]>();

function getHistory(channelId: string): ChatMessage[] {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  return conversationHistory.get(channelId)!;
}

function addToHistory(channelId: string, role: "user" | "assistant", content: string) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2);
  }
}

async function streamReply(
  channelId: string,
  userMessage: string,
  onChunk: (text: string) => void
): Promise<string> {
  const history = getHistory(channelId);

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error ${response.status}: ${text}`);
  }

  let fullText = "";
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") break;
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const token = parsed.choices?.[0]?.delta?.content ?? "";
        if (token) {
          fullText += token;
          onChunk(fullText);
        }
      } catch {}
    }
  }

  fullText = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return fullText || "Sorry, I couldn't generate a response. Please try again.";
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
  console.log(`Using Groq model: ${MODEL}`);
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

  try {
    const channelId = message.channel.id;
    addToHistory(channelId, "user", userMessage);

    const sentMessage = await message.reply("▍");

    let lastEdit = Date.now();
    let finalText = "";

    await streamReply(channelId, userMessage, (currentText) => {
      finalText = currentText;
      const now = Date.now();
      if (now - lastEdit >= 750) {
        lastEdit = now;
        const display = currentText.length > 1900
          ? currentText.slice(0, 1900) + "..."
          : currentText + " ▍";
        sentMessage.edit(display).catch(() => {});
      }
    });

    const finalDisplay = finalText.length > 1900
      ? finalText.slice(0, 1900) + "..."
      : finalText || "Sorry, I couldn't generate a response. Please try again.";

    await sentMessage.edit(finalDisplay);
    addToHistory(channelId, "assistant", finalDisplay);
    console.log(`[Bot replied to ${message.author.tag}]`);
  } catch (error) {
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
