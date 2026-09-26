/**
 * AI AVENGERS HQ — Server
 * ------------------------
 * A WebSocket hub that:
 *   - Authenticates members by their fixed code
 *   - Tracks who is online/offline in real time
 *   - Broadcasts chat messages to everyone connected (this IS the
 *     AI-to-AI routing: every connected agent receives every
 *     message, including ones sent by other agents, so any agent
 *     can react to any other agent the same way it reacts to the
 *     human captain)
 *   - Keeps recent message history so an AI can answer
 *     "what did I say earlier?"
 *   - Broadcasts typing indicators
 *   - Breaks AI-to-AI reply loops so two agents can't bounce
 *     messages off each other forever
 *
 * PROTOCOL
 *   Login:   { "type": "login", "code": "CLA-904" }
 *   Message: { "type": "message", "message": "text here" }
 *   Typing:  { "type": "typing", "typing": true }
 *
 * Run with:  node hq-server.js
 * Requires:  npm install ws
 */

const { WebSocketServer } = require("ws");
const http = require("http");

// ---- CONFIG ----------------------------------------------------

const PORT = process.env.PORT || 8080;
const HISTORY_LIMIT = 100; // how many recent messages to retain
const AI_LOOP_LIMIT = 6;   // consecutive AI-only messages before pausing auto-replies

// Members are defined here, server-side. Codes never need to be
// exposed in any public HTML — clients only send their code once,
// over the WebSocket, to authenticate.
const MEMBERS = {
  "1234":     { name: "YOU",      role: "CAPTAIN",    human: true },
  "CPT-741":  { name: "ChatGPT",  role: "CAPTAIN AI", human: false },
  "META-218": { name: "Meta AI",  role: "AI AGENT",   human: false },
  "MAN-563":  { name: "Manus",    role: "AI AGENT",   human: false },
  "CLA-904":  { name: "Claude",   role: "AI AGENT",   human: false },
};

// ---- STATE -------------------------------------------------------

// code -> { name, role, human, online, socket }
const memberState = {};
for (const code of Object.keys(MEMBERS)) {
  memberState[code] = { ...MEMBERS[code], online: false, socket: null };
}

const history = []; // { code, name, role, message, ts }

let aiStreak = 0;        // consecutive messages sent by AI agents (no human in between)
let aiLoopPaused = false; // true once the streak limit is hit

// ---- HELPERS -----------------------------------------------------

function presenceSnapshot() {
  return Object.entries(memberState).map(([code, m]) => ({
    code,
    name: m.name,
    role: m.role,
    online: m.online,
  }));
}

function broadcast(payload) {
  const raw = JSON.stringify(payload);
  for (const m of Object.values(memberState)) {
    if (m.online && m.socket && m.socket.readyState === 1) {
      try {
        m.socket.send(raw);
      } catch (err) {
        // A single dead/half-closed connection must never take down
        // the whole server or block delivery to everyone else.
        console.error(`Failed to send to ${m.name}:`, err.message);
      }
    }
  }
}

function pushHistory(entry) {
  history.push(entry);
  if (history.length > HISTORY_LIMIT) history.shift();
}

// ---- SERVER --------------------------------------------------------

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("AI Avengers HQ server is running.\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  let loggedInCode = null;

  // Without this, an unexpected socket error (e.g. a client's
  // connection dying mid-write) is an unhandled 'error' event —
  // which crashes the entire Node process, taking every other
  // connected member down with it. One flaky client must never be
  // able to kill the whole HQ.
  socket.on("error", (err) => {
    console.error("Connection error:", err.message);
  });

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    // ---- LOGIN ----
    if (msg.type === "login") {
      const code = msg.code;
      const member = memberState[code];

      if (!member) {
        socket.send(JSON.stringify({ type: "login_error", message: "Invalid code" }));
        socket.close();
        return;
      }

      // If this code is already connected elsewhere, boot the old socket.
      if (member.socket && member.socket.readyState === 1) {
        member.socket.send(JSON.stringify({ type: "kicked", message: "Logged in elsewhere" }));
        member.socket.close();
      }

      loggedInCode = code;
      member.online = true;
      member.socket = socket;

      socket.send(JSON.stringify({
        type: "login_ok",
        code,
        name: member.name,
        role: member.role,
        members: presenceSnapshot(),
        history, // recent chat log, so a freshly-connected AI has context
      }));

      broadcast({ type: "presence", members: presenceSnapshot() });
      broadcast({
        type: "system",
        text: `${member.name} entered HQ.`,
        ts: Date.now(),
      });
      return;
    }

    if (!loggedInCode) {
      socket.send(JSON.stringify({ type: "error", message: "Not logged in" }));
      return;
    }

    const member = memberState[loggedInCode];

    // ---- CHAT MESSAGE ----
    if (msg.type === "message") {
      const entry = {
        code: loggedInCode,
        name: member.name,
        role: member.role,
        message: String(msg.message || "").slice(0, 4000),
        ts: Date.now(),
      };
      pushHistory(entry);

      // ---- AI-to-AI loop breaker ----
      if (member.human) {
        aiStreak = 0;
        aiLoopPaused = false;
      } else {
        aiStreak += 1;
        if (aiStreak >= AI_LOOP_LIMIT && !aiLoopPaused) {
          aiLoopPaused = true;
          broadcast({
            type: "system",
            text: `AI-to-AI reply chain paused after ${AI_LOOP_LIMIT} consecutive agent messages. Send a message as the captain to resume.`,
            ts: Date.now(),
          });
        }
      }

      broadcast({ type: "message", ...entry, aiLoopPaused });
      return;
    }

    // ---- TYPING INDICATOR ----
    if (msg.type === "typing") {
      broadcast({
        type: "typing",
        code: loggedInCode,
        name: member.name,
        typing: !!msg.typing,
      });
      return;
    }

    // ---- HISTORY REQUEST (e.g. "what did I say earlier?") ----
    if (msg.type === "get_history") {
      socket.send(JSON.stringify({ type: "history", history }));
      return;
    }
  });

  socket.on("close", () => {
    if (!loggedInCode) return;
    const member = memberState[loggedInCode];
    if (member.socket === socket) {
      member.online = false;
      member.socket = null;
      broadcast({ type: "presence", members: presenceSnapshot() });
      broadcast({
        type: "system",
        text: `${member.name} disconnected.`,
        ts: Date.now(),
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`AI Avengers HQ server listening on ws://localhost:${PORT}`);
});

// Last line of defense: log and keep running instead of crashing on
// any error that somehow still slips through uncaught. A group chat
// server should degrade a single bad connection, never take the
// whole HQ offline.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server stayed up):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (server stayed up):", err);
});
