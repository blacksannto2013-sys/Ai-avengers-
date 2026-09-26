/**
 * End-to-end test for AI Avengers HQ.
 * Runs against the REAL hq-server.js and REAL connector-base.js.
 * generateReply() is mocked (canned text instead of a live paid API
 * call, since this environment has no internet access) — everything
 * else is the real, unmodified code path: WebSocket connect, login,
 * presence broadcast, chat broadcast, typing indicators, history
 * sync, and the AI-to-AI loop breaker.
 */
const WebSocket = require("ws");
const { createAgentConnector } = require("./connector-base");

const HQ_URL = "ws://localhost:8123";
let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}`); fail++; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout waiting for: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loginAndCollect(code, { collectUntilType } = {}) {
  const ws = new WebSocket(HQ_URL);
  const received = [];
  ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
  await withTimeout(
    new Promise((resolve, reject) => {
      ws.on("open", () => ws.send(JSON.stringify({ type: "login", code })));
      ws.on("error", reject);
      const checkInterval = setInterval(() => {
        if (!collectUntilType || received.some((m) => m.type === collectUntilType)) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 20);
    }),
    5000,
    `login as ${code}`
  );
  return { ws, received }; // `received` keeps growing after this resolves — one shared array, one listener
}

async function main() {
  console.log("== 1. Connect all 4 agents (mocked replies, real WS/login/protocol) ==");

  const agentDefs = [
    { code: "CLA-904", name: "Claude", role: "AI AGENT" },
    { code: "CPT-741", name: "ChatGPT", role: "CAPTAIN AI" },
    { code: "META-218", name: "Meta AI", role: "AI AGENT" },
    { code: "MAN-563", name: "Manus", role: "AI AGENT" },
  ];

  const connectors = agentDefs.map((a) =>
    createAgentConnector({
      hqUrl: HQ_URL,
      code: a.code,
      name: a.name,
      role: a.role,
      generateReply: async (history, sender, text) => `[mock reply from ${a.name} to ${sender}]`,
    })
  );

  await sleep(1000); // let all four log in

  console.log("\n== 2. Human captain connects, checks presence ==");
  const { ws: human, received: allHumanMsgs } = await loginAndCollect("1234", { collectUntilType: "login_ok" });
  const loginOk = allHumanMsgs.find((m) => m.type === "login_ok");
  check("human login_ok received", !!loginOk);
  check("all 5 members (4 agents + human) show online", loginOk && loginOk.members.filter((m) => m.online).length === 5);

  console.log("\n== 3. Human sends a message mentioning Claude ==");
  human.send(JSON.stringify({ type: "message", message: "Hey Claude, are you there?" }));
  await sleep(1200);

  const msgsSoFar = allHumanMsgs.filter((m) => m.type === "message");
  const typingSoFar = allHumanMsgs.filter((m) => m.type === "typing");

  check("human's own message was broadcast back", msgsSoFar.some((m) => m.message === "Hey Claude, are you there?"));
  check("Claude sent typing:true", typingSoFar.some((t) => t.name === "Claude" && t.typing === true));
  check("Claude sent typing:false after replying", typingSoFar.some((t) => t.name === "Claude" && t.typing === false));
  check("Claude replied in the chat", msgsSoFar.some((m) => m.name === "Claude" && m.message.includes("mock reply")));
  check("ChatGPT did NOT reply (wasn't addressed)", !msgsSoFar.some((m) => m.name === "ChatGPT"));

  console.log("\n== 4. Disconnect Claude's connector, verify offline presence ==");
  connectors[0].stop();
  await sleep(1500);
  const presenceMsgs = allHumanMsgs.filter((m) => m.type === "presence");
  const lastPresence = presenceMsgs[presenceMsgs.length - 1];
  check("presence update received after Claude disconnected", !!lastPresence);
  check("Claude shows offline in latest presence snapshot",
    lastPresence && lastPresence.members.find((m) => m.name === "Claude").online === false);

  console.log("\n== 5. Fresh connection receives chat history on login ==");
  const { received: claudeProbeInbox, ws: claudeProbeWs } = await loginAndCollect("CLA-904", { collectUntilType: "login_ok" });
  const probeLoginOk = claudeProbeInbox.find((m) => m.type === "login_ok");
  check("freshly (re)connected client receives non-empty history", probeLoginOk && probeLoginOk.history.length > 0);
  claudeProbeWs.close();

  console.log("\n== 6. AI-to-AI loop breaker: flood agent-only messages ==");
  const { ws: chatgptDirect } = await loginAndCollect("CPT-741", {});
  await sleep(300);

  for (let i = 0; i < 7; i++) {
    chatgptDirect.send(JSON.stringify({ type: "message", message: `Manus, ping ${i}` }));
    await sleep(150);
  }
  await sleep(500);

  const systemMsgs = allHumanMsgs.filter((m) => m.type === "system");
  const pausedMsgs = allHumanMsgs.filter((m) => m.type === "message" && m.aiLoopPaused === true);
  check("server broadcast a loop-pause system message", systemMsgs.some((m) => /paused/i.test(m.text)));
  check("subsequent broadcasts carry aiLoopPaused: true", pausedMsgs.length > 0);

  console.log("\n== 7. Human message resets the loop breaker ==");
  const beforeReset = allHumanMsgs.length;
  human.send(JSON.stringify({ type: "message", message: "OK team, stand down." }));
  await sleep(500);
  const newMsgs = allHumanMsgs.slice(beforeReset).filter((m) => m.type === "message");
  check("human message broadcasts with aiLoopPaused: false", newMsgs.some((m) => m.name === "YOU" && m.aiLoopPaused === false));

  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);

  connectors.forEach((c) => { try { c.stop(); } catch {} });
  try { human.close(); } catch {}
  try { chatgptDirect.close(); } catch {}

  await sleep(300);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
