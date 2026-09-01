// Mechanical-capture classification tests: capture outward/mutating actions, ignore
// reads, and never misclassify because of trigger words inside quoted args.

import assert from "node:assert/strict";
import { classify } from "../src/hook.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log("ok -", name);
}

const ev = (tool_name: string, tool_input: Record<string, unknown>) => ({ tool_name, tool_input });

check("message send is captured, text not required", () => {
  const c = classify(ev("mcp__openclaw__message", { action: "send", channel: "discord", target: "1", message: "secret" }));
  assert.equal(c?.kind, "message.send");
  assert.equal(c?.data.textLen, 6);
  assert.ok(!("message" in (c?.data ?? {})), "raw text must not be in data");
});

check("message read/react are skipped", () => {
  assert.equal(classify(ev("mcp__openclaw__message", { action: "read" })), null);
  assert.equal(classify(ev("mcp__openclaw__message", { action: "react" })), null);
});

check("pure read tools are skipped", () => {
  for (const t of ["Read", "Grep", "Glob", "web_search", "web_fetch", "mcp__openclaw__memory_get"]) {
    assert.equal(classify(ev(t, { file_path: "/x" })), null, `${t} should skip`);
  }
});

check("Write/Edit captured, writes to blocktrain data skipped", () => {
  assert.equal(classify(ev("Write", { file_path: "/home/m/projects/blocktrain/src/a.ts" }))?.kind, "file.write");
  assert.equal(classify(ev("Edit", { file_path: "/home/m/x.ts" }))?.kind, "file.edit");
  assert.equal(classify(ev("Write", { file_path: "/home/m/projects/blocktrain/data/log.jsonl" })), null);
});

check("bash: mutating verbs captured", () => {
  assert.equal(classify(ev("Bash", { command: "git push origin master" }))?.kind, "shell.git.push");
  assert.equal(classify(ev("Bash", { command: "git -c user.name=x commit -m 'msg'" }))?.kind, "shell.git.commit");
  assert.equal(classify(ev("Bash", { command: "scp f root@h:/opt/" }))?.kind, "shell.deploy.scp");
  assert.equal(classify(ev("Bash", { command: "systemctl restart bsv-cx.service" }))?.kind, "shell.service.systemctl");
});

check("bash: reads skipped", () => {
  for (const cmd of ["ls -la", "cat file", "grep -r x .", "node test/x.ts", "tail -2 log"]) {
    assert.equal(classify(ev("Bash", { command: cmd })), null, `'${cmd}' should skip`);
  }
});

check("bash: trigger words inside quotes do NOT misclassify", () => {
  // a commit whose message mentions 'git push'/'scp' must stay git.commit
  assert.equal(
    classify(ev("Bash", { command: "git commit -m \"mentions git push and scp\"" }))?.kind,
    "shell.git.commit",
  );
  // an echo that merely mentions scp is not a deploy
  assert.equal(classify(ev("Bash", { command: "echo \"deploy via scp later\"" })), null);
});

check("agent + schedule + media", () => {
  assert.equal(classify(ev("mcp__openclaw__sessions_send", { sessionKey: "s" }))?.kind, "agent.message");
  assert.equal(classify(ev("mcp__openclaw__cron", { action: "add" }))?.kind, "schedule.add");
  assert.equal(classify(ev("mcp__openclaw__cron", { action: "list" })), null);
  assert.equal(classify(ev("mcp__openclaw__image_generate", {}))?.kind, "media.image");
});

console.log(`\n${pass} hook checks passed`);
