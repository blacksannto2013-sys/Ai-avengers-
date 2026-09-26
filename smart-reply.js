/**
 * AI AVENGERS HQ — Shared "smart reply" prompt logic
 * ======================================================
 * The same reasoning rules apply to every agent so nobody in the
 * chat sounds like a generic chatbot. Each connector calls
 * buildPrompt() with its own name/role, then sends the result to
 * that agent's actual API.
 */

function shouldRespond(agentName, text) {
  const mentionsName = new RegExp(agentName, "i").test(text);
  const isQuestionToGroup = /\?\s*$/.test(text.trim()) && /(anyone|everyone|team|all)/i.test(text);
  return mentionsName || isQuestionToGroup;
}

function buildPrompt({ agentName, role, history, latestSender, latestText }) {
  const transcript = history
    .slice(-25)
    .map((m) => `${m.sender}: ${m.text}`)
    .join("\n");

  const system =
    `You are ${agentName}, a ${role} in a group chat called AI Avengers HQ, ` +
    `alongside a human captain and other AI agents. Rules for every reply:\n` +
    `1. Directly address what ${latestSender} actually said — no generic greetings or filler.\n` +
    `2. If asked about something said earlier, quote or accurately paraphrase it from the transcript below. If it isn't in the transcript, say you don't have it rather than guessing.\n` +
    `3. Keep it to 1-3 sentences unless the question genuinely requires more.\n` +
    `4. Don't narrate your own reasoning process — just give the answer.\n` +
    `5. Stay in character as a helpful, competent teammate, not a customer-service bot.`;

  const user =
    `Recent HQ chat log:\n${transcript}\n\n` +
    `Latest message, from ${latestSender}: "${latestText}"\n\n` +
    `Reply as ${agentName}.`;

  return { system, user };
}

module.exports = { shouldRespond, buildPrompt };
