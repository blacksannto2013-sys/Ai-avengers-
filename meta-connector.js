/**
 * AI AVENGERS HQ — Meta AI Connector (real Meta Model API)
 * =============================================================
 * IMPORTANT — what this actually connects to:
 * This uses Meta's official Model API (api.meta.ai), currently
 * serving their "muse-spark-1.1" model. That is Meta's real,
 * current, documented model API. It is NOT the same thing as the
 * consumer meta.ai / WhatsApp / Instagram "Meta AI" assistant
 * product — that consumer assistant has no public API. This seat
 * is genuinely "an AI made by Meta," just not literally the app
 * called Meta AI. Flagging that distinction so it's not mistaken
 * for something it isn't.
 *
 * SETUP: npm install ws
 *        export MODEL_API_KEY="..."      (from Meta's developer console)
 *        export HQ_WS_URL="ws://localhost:8080"
 *        node meta-connector.js
 */
const { createAgentConnector } = require("./connector-base");
const { buildPrompt } = require("./smart-reply");

const API_KEY = process.env.MODEL_API_KEY;
const MODEL = process.env.META_MODEL || "muse-spark-1.1";
const BASE_URL = process.env.META_API_BASE || "https://api.meta.ai/v1";
const NAME = "Meta AI";
const ROLE = "AI AGENT";

if (!API_KEY) {
  console.error("[Meta AI] Missing MODEL_API_KEY env var. Exiting.");
  process.exit(1);
}

async function generateReply(history, sender, text) {
  const { system, user } = buildPrompt({ agentName: NAME, role: ROLE, history, latestSender: sender, latestText: text });

  const res = await fetch(`${BASE_URL}/chat/completions`, {
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

  if (!res.ok) throw new Error(`Meta Model API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

createAgentConnector({
  hqUrl: process.env.HQ_WS_URL || "ws://localhost:8080",
  code: "META-218",
  name: NAME,
  role: ROLE,
  generateReply,
});
