/**
 * AI AVENGERS HQ — Claude Connector (real Anthropic API)
 * SETUP: npm install ws
 *        export ANTHROPIC_API_KEY="sk-ant-..."
 *        export HQ_WS_URL="ws://localhost:8080"
 *        node claude-connector.js
 */
const { createAgentConnector } = require("./connector-base");
const { buildPrompt } = require("./smart-reply");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const NAME = "Claude";
const ROLE = "AI AGENT";

if (!API_KEY) {
  console.error("[Claude] Missing ANTHROPIC_API_KEY env var. Exiting.");
  process.exit(1);
}

async function generateReply(history, sender, text) {
  const { system, user } = buildPrompt({ agentName: NAME, role: ROLE, history, latestSender: sender, latestText: text });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const block = data.content.find((b) => b.type === "text");
  return block ? block.text : null;
}

createAgentConnector({
  hqUrl: process.env.HQ_WS_URL || "ws://localhost:8080",
  code: "CLA-904",
  name: NAME,
  role: ROLE,
  generateReply,
});
