/**
 * AI AVENGERS HQ — ChatGPT Connector (real OpenAI API)
 * SETUP: npm install ws
 *        export OPENAI_API_KEY="sk-..."
 *        export HQ_WS_URL="ws://localhost:8080"
 *        node chatgpt-connector.js
 */
const { createAgentConnector } = require("./connector-base");
const { buildPrompt } = require("./smart-reply");

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const NAME = "ChatGPT";
const ROLE = "CAPTAIN AI";

if (!API_KEY) {
  console.error("[ChatGPT] Missing OPENAI_API_KEY env var. Exiting.");
  process.exit(1);
}

async function generateReply(history, sender, text) {
  const { system, user } = buildPrompt({ agentName: NAME, role: ROLE, history, latestSender: sender, latestText: text });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

createAgentConnector({
  hqUrl: process.env.HQ_WS_URL || "ws://localhost:8080",
  code: "CPT-741",
  name: NAME,
  role: ROLE,
  generateReply,
});
