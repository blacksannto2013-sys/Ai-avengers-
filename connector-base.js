/**
 * AI AVENGERS HQ — Shared connector base
 * ==========================================
 * All the plumbing every agent connector needs, so each specific
 * connector file only has to implement one function: how to call
 * its own AI's real API.
 *
 * PROTOCOL (must match hq-server.js exactly):
 *   Login:   { "type": "login", "code": "<AGENT_CODE>" }
 *   Message: { "type": "message", "message": "text" }
 *   Typing:  { "type": "typing", "typing": true|false }
 *
 * Handles: connect, login, auto-reconnect w/ backoff, rolling
 * history, typing indicators, and respecting the server's
 * AI-to-AI loop-pause flag (aiLoopPaused) so agents don't bounce
 * messages off each other forever without a human in the loop.
 */

const WebSocket = require("ws");
const { shouldRespond } = require("./smart-reply");

function extractSender(msg) {
  return msg.name || msg.sender || msg.code || "Unknown";
}
function extractText(msg) {
  return msg.message || msg.text || "";
}

function createAgentConnector({
  hqUrl,
  code,
  name,
  role,
  generateReply, // async (history, sender, text) => string | null
  maxHistory = 100,
}) {
  let ws = null;
  let history = [];
  let reconnectDelay = 1000;
  const RECONNECT_MAX = 30000;
  let intentionalClose = false;
  let loopPaused = false;

  function log(...args) {
    console.log(`[${name}]`, ...args);
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function connect() {
    log(`Connecting to ${hqUrl} ...`);
    ws = new WebSocket(hqUrl);

    ws.on("open", () => {
      reconnectDelay = 1000;
      send({ type: "login", code });
      log(`Sent login as ${code}.`);
    });

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "login_ok") {
        log(`Logged in as ${msg.name}. Online members:`, msg.members.filter(m => m.online).map(m => m.name));
        if (Array.isArray(msg.history)) {
          history = msg.history
            .map((m) => ({ sender: extractSender(m), text: extractText(m), ts: m.ts || Date.now() }))
            .slice(-maxHistory);
        }
        return;
      }

      if (msg.type === "login_error") {
        console.error(`[${name}] Login rejected:`, msg.message);
        intentionalClose = true;
        ws.close();
        return;
      }

      if (msg.type === "history" && Array.isArray(msg.history)) {
        history = msg.history
          .map((m) => ({ sender: extractSender(m), text: extractText(m), ts: m.ts || Date.now() }))
          .slice(-maxHistory);
        return;
      }

      if (msg.type === "message") {
        const sender = extractSender(msg);
        const text = extractText(msg);
        loopPaused = !!msg.aiLoopPaused;

        history.push({ sender, text, ts: msg.ts || Date.now() });
        if (history.length > maxHistory) history.shift();

        // Don't reply to your own broadcasted message.
        if (sender === name || msg.code === code) return;

        // Respect the server's AI-to-AI loop breaker.
        if (loopPaused) {
          log("AI-to-AI loop pause is active — staying quiet until a human speaks.");
          return;
        }

        if (!shouldRespond(name, text)) return;

        await handleIncoming(sender, text);
        return;
      }

      // presence / typing / system frames: nothing required here,
      // but available if a specific connector wants to react to them.
    });

    ws.on("close", () => {
      log("Disconnected.");
      if (intentionalClose) return;
      log(`Reconnecting in ${reconnectDelay}ms...`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    });

    ws.on("error", (err) => {
      console.error(`[${name}] Socket error:`, err.message);
    });
  }

  async function handleIncoming(sender, text) {
    send({ type: "typing", typing: true });
    try {
      const reply = await generateReply(history, sender, text);
      send({ type: "typing", typing: false });
      if (reply) {
        send({ type: "message", message: reply });
        history.push({ sender: name, text: reply, ts: Date.now() });
      }
    } catch (err) {
      send({ type: "typing", typing: false });
      console.error(`[${name}] generateReply error:`, err.message);
    }
  }

  connect();

  return {
    stop() {
      intentionalClose = true;
      if (ws) ws.close();
    },
  };
}

module.exports = { createAgentConnector };
