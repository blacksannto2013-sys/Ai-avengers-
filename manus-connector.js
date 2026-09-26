/**
 * AI AVENGERS HQ — Manus Connector (real Manus API)
 * =====================================================
 * IMPORTANT — how this API actually behaves:
 * Manus's API is task-based and asynchronous, not an instant chat
 * endpoint: you POST a task, then POLL until it's done. That means
 * Manus's replies in this chat will always lag behind Claude's or
 * ChatGPT's by however long the poll loop takes (seconds, sometimes
 * longer for complex tasks) — that's inherent to Manus's real API,
 * not a bug in this connector.
 *
 * Uses Manus API v1 (OpenAI-Responses-compatible). Manus's docs
 * currently flag v1 as deprecated in favor of v2 — v2's request/
 * response shape wasn't in their public docs at the time this was
 * written, so this targets v1. Check https://open.manus.ai/docs/v2
 * before relying on this long-term.
 *
 * SETUP: npm install ws
 *        export MANUS_API_KEY="..."      (from manus.im account settings)
 *        export HQ_WS_URL="ws://localhost:8080"
 *        node manus-connector.js
 */
const { createAgentConnector } = require("./connector-base");
const { buildPrompt } = require("./smart-reply");

const API_KEY = process.env.MANUS_API_KEY;
const BASE_URL = process.env.MANUS_API_BASE || "https://api.manus.im";
const AGENT_PROFILE = process.env.MANUS_PROFILE || "manus-1.6-lite"; // lite = fastest, best fit for chat
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60000; // give up after 60s so the chat doesn't hang forever
const NAME = "Manus";
const ROLE = "AI AGENT";

if (!API_KEY) {
  console.error("[Manus] Missing MANUS_API_KEY env var. Exiting.");
  process.exit(1);
}

async function generateReply(history, sender, text) {
  const { user } = buildPrompt({ agentName: NAME, role: ROLE, history, latestSender: sender, latestText: text });

  // 1. Create the task.
  const createRes = await fetch(`${BASE_URL}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      API_KEY: API_KEY,
    },
    body: JSON.stringify({
      input: [{ role: "user", content: [{ type: "input_text", text: user }] }],
      task_mode: "agent",
      agent_profile: AGENT_PROFILE,
    }),
  });

  if (!createRes.ok) throw new Error(`Manus API ${createRes.status}: ${await createRes.text()}`);

  const created = await createRes.json();
  const taskId = created.id;

  // 2. Poll until the task is done (Manus's API is async by design).
  const startedAt = Date.now();
  let finalTask = created;

  while (finalTask.status === "running") {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`Manus task ${taskId} timed out after ${POLL_TIMEOUT_MS}ms`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${BASE_URL}/v1/responses/${taskId}`, {
      headers: { API_KEY: API_KEY },
    });
    if (!pollRes.ok) throw new Error(`Manus poll ${pollRes.status}: ${await pollRes.text()}`);
    finalTask = await pollRes.json();
  }

  if (finalTask.status !== "completed") {
    throw new Error(`Manus task ${taskId} ended with status: ${finalTask.status}`);
  }

  // 3. Pull the assistant's text out of the output array.
  const assistantMsg = (finalTask.output || []).find((m) => m.role === "assistant");
  const textPart = assistantMsg?.content?.find((c) => c.text);
  return textPart ? textPart.text : null;
}

createAgentConnector({
  hqUrl: process.env.HQ_WS_URL || "ws://localhost:8080",
  code: "MAN-563",
  name: NAME,
  role: ROLE,
  generateReply,
});
