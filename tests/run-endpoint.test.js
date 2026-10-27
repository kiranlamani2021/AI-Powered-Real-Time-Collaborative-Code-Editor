/**
 * Execution-endpoint regression tests (node:test, no extra dependencies).
 *
 * Requires the backend to be running:
 *   cd ai-code-editor && npm start
 * then:
 *   npm test
 *
 * Optional: BASE_URL=http://localhost:5000
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:5000";
const STAMP = Date.now().toString(36);
let token = "";

const api = async (pathname, options = {}) => {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

const runCode = async (language, code, input) => {
  const started = Date.now();
  const { status, body } = await api("/run", {
    method: "POST",
    body: JSON.stringify({
      language,
      code,
      ...(input !== undefined ? { input } : {}),
    }),
  });
  return { status, body, durationMs: Date.now() - started };
};

before(async () => {
  // Preflight: server must be up, otherwise every test would fail confusingly.
  let reachable = false;
  try {
    const probe = await fetch(BASE + "/", { method: "GET" });
    reachable = probe.status < 500 || probe.status === 404;
  } catch {
    reachable = false;
  }
  assert.ok(
    reachable,
    `Backend is not reachable at ${BASE}. Start it with: cd ai-code-editor && npm start`
  );

  const email = `rangetest${STAMP}@example.com`;
  const register = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: `rangetest${STAMP}`,
      email,
      password: "audit-pass-1",
    }),
  });
  if (register.status === 201) {
    token = register.body.token;
  } else {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "audit-pass-1" }),
    });
    assert.equal(login.status, 200, "login after register failed");
    token = login.body.token;
  }
  assert.ok(token, "no auth token");
});

after(() => {
  // Nothing persistent to clean up; users created here are throwaway test data.
});

/* ------------------------- validation & auth ------------------------- */

test("rejects unauthenticated execution", async () => {
  const saved = token;
  token = "";
  const { status } = await runCode("javascript", "1");
  token = saved;
  assert.equal(status, 401);
});

test("rejects unsupported language", async () => {
  const { status, body } = await runCode("ruby", "puts 1");
  assert.equal(status, 400);
  assert.match(body.output, /Unsupported/i);
});

test("rejects oversized code", async () => {
  const { status } = await runCode("javascript", "x".repeat(100001));
  assert.equal(status, 400);
});

test("rejects oversized input", async () => {
  const { status } = await runCode("javascript", "1", "i".repeat(20001));
  assert.equal(status, 400);
});

test("language field cannot inject shell commands", async () => {
  const { status } = await runCode("javascript; rm -rf /", "1");
  assert.equal(status, 400);
});

/* ------------------------- JavaScript ------------------------- */

test("javascript: valid program", async () => {
  const { status, body } = await runCode("javascript", "console.log('JS-OK');");
  assert.equal(status, 200);
  assert.equal(body.status, "success");
  assert.equal(body.output.trim(), "JS-OK");
  assert.equal(body.exitCode, 0);
  assert.equal(typeof body.durationMs, "number");
});

test("javascript: empty output stays empty string", async () => {
  const { body } = await runCode("javascript", "// nothing here");
  assert.equal(body.status, "success");
  assert.equal(body.output, "");
});

test("javascript: syntax error is a runtime error, not a timeout", async () => {
  const { body } = await runCode("javascript", "conso; l.e(");
  assert.equal(body.status, "runtime_error");
  assert.equal(body.timedOut, false);
  assert.match(body.output, /SyntaxError|Error/i);
});

test("javascript: stdout and stderr are captured separately", async () => {
  const { body } = await runCode(
    "javascript",
    "console.log('to-stdout'); console.error('to-stderr');"
  );
  assert.equal(body.status, "success");
  assert.match(body.stdout, /to-stdout/);
  assert.match(body.stderr, /to-stderr/);
});

/* ------------------------- Python ------------------------- */

test("python: valid program with stdin", async () => {
  const { body } = await runCode(
    "python",
    "name = input()\nprint('hello', name)",
    "world"
  );
  assert.equal(body.status, "success");
  assert.match(body.output, /hello world/);
});

test("python: reading stdin with no input ends promptly (EOF, not a hang)", async () => {
  const { body, durationMs } = await runCode("python", "print(input())");
  assert.ok(durationMs < 5000, `took ${durationMs}ms`);
  assert.notEqual(body.status, "timeout");
  assert.equal(body.status, "runtime_error"); // EOFError from closed stdin
  assert.match(body.output, /EOFError/);
});

test("python: runtime error surfaces the traceback", async () => {
  const { body } = await runCode("python", "print(1/0)");
  assert.equal(body.status, "runtime_error");
  assert.match(body.output, /ZeroDivisionError/);
});

/* ------------------------- C++ ------------------------- */

test("cpp: compiles and runs", async () => {
  const { body } = await runCode(
    "cpp",
    '#include <iostream>\nint main(){ std::cout << "CPP-OK" << std::endl; return 0; }'
  );
  assert.equal(body.status, "success");
  assert.match(body.output, /CPP-OK/);
});

test("cpp: compile error is reported as compile_error", async () => {
  const { body } = await runCode("cpp", "int main( { return 0; }");
  assert.equal(body.status, "compile_error");
  assert.equal(body.timedOut, false);
  assert.match(body.output, /error/i);
});

/* ------------------------- Java ------------------------- */

test("java: compiles and runs", async () => {
  const { body } = await runCode(
    "java",
    'public class Main { public static void main(String[] a){ System.out.println("JAVA-OK"); } }'
  );
  assert.equal(body.status, "success");
  assert.match(body.output, /JAVA-OK/);
});

test("java: compile error is reported as compile_error", async () => {
  const { body } = await runCode("java", "public class Main { broken");
  assert.equal(body.status, "compile_error");
  assert.match(body.output, /error/i);
});

/* ------------------------- Go ------------------------- */

test("go: builds (separate compile phase) and runs", async () => {
  const { body } = await runCode(
    "go",
    'package main\nimport "fmt"\nfunc main(){ fmt.Println("GO-OK") }'
  );
  assert.equal(body.status, "success");
  assert.match(body.output, /GO-OK/);
});

test("go: compile error is reported as compile_error", async () => {
  const { body } = await runCode(
    "go",
    "package main\nfunc main(){ undefinedThing() }"
  );
  assert.equal(body.status, "compile_error");
});

/* ------------------------- PHP ------------------------- */

test("php: valid program", async () => {
  const { body } = await runCode("php", '<?php echo "PHP-OK\\n"; ?>');
  assert.equal(body.status, "success");
  assert.match(body.output, /PHP-OK/);
});

test("php: runtime error goes to stderr/runtime_error", async () => {
  const { body } = await runCode("php", '<?php throw new Exception("boom"); ?>');
  assert.notEqual(body.status, "success");
  assert.notEqual(body.status, "timeout");
  assert.match(body.output, /boom|Exception/i);
});

/* ------------------------- timeouts ------------------------- */

test(
  "infinite loop hits the execution timeout with an accurate message",
  { timeout: 60000 },
  async () => {
    const { body, durationMs } = await runCode("python", "while True:\n    pass");
    assert.equal(body.status, "timeout");
    assert.equal(body.timedOut, true);
    assert.match(body.output, /Execution Timed Out/);
    assert.match(body.output, /15 seconds/);
    // The 15s execution timeout must actually be enforced (~15s, not less).
    assert.ok(durationMs >= 14000, `finished too early: ${durationMs}ms`);
    assert.ok(durationMs < 30000, `took too long to kill: ${durationMs}ms`);
  }
);

/* ------------------------- isolation & secrets ------------------------- */

test("submitted code cannot see server secrets in its environment", async () => {
  const { body } = await runCode(
    "javascript",
    "const suspicious = Object.keys(process.env).filter(k => /SECRET|TOKEN|PASSWORD|MONGO|GEMINI|API_KEY/i.test(k));\n" +
      "console.log(JSON.stringify({ suspicious, jwt: typeof process.env.JWT_SECRET, gemini: typeof process.env.GEMINI_API_KEY }));"
  );
  assert.equal(body.status, "success");
  const parsed = JSON.parse(body.output.trim());
  assert.deepEqual(parsed.suspicious, []);
  assert.equal(parsed.jwt, "undefined");
  assert.equal(parsed.gemini, "undefined");
});

test("submitted code runs in an isolated temp directory, not the project", async () => {
  const { body } = await runCode(
    "javascript",
    "console.log(JSON.stringify({ cwd: process.cwd(), files: require('fs').readdirSync('.') }));"
  );
  assert.equal(body.status, "success");
  const parsed = JSON.parse(body.output.trim());
  // Isolated per-run temp dir — never the project folder.
  assert.match(parsed.cwd, /ace-run-/);
  // Only the program's own source file is visible: no .env, no server code.
  assert.ok(!parsed.files.includes(".env"), "project .env must not be visible");
  assert.ok(!parsed.files.includes("server.js"), "project files must not be visible");
  assert.equal(parsed.files.length, 1);
  assert.match(parsed.files[0], /\.js$/);
});

test("no ace-run-* temp directories remain after execution", async () => {
  await runCode("javascript", "console.log('cleanup-check');");
  const leftovers = fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith("ace-run-"))
    .filter((name) => {
      try {
        return fs.statSync(path.join(os.tmpdir(), name)).isDirectory();
      } catch {
        return false;
      }
    });
  assert.deepEqual(leftovers, []);
});

/* ------------------------- robustness ------------------------- */

test("concurrent executions do not interfere", async () => {
  const results = await Promise.all([
    runCode("javascript", "console.log('CONC-1');"),
    runCode("python", "print('CONC-2')"),
    runCode("javascript", "console.log('CONC-3');"),
  ]);
  assert.equal(results[0].body.output.trim(), "CONC-1");
  assert.match(results[1].body.output, /CONC-2/);
  assert.equal(results[2].body.output.trim(), "CONC-3");
  for (const r of results) assert.equal(r.body.status, "success");
});

test("huge output is truncated with a notice instead of breaking the server", async () => {
  const { body } = await runCode(
    "javascript",
    "const chunk = 'x'.repeat(1024);\nfor (let i = 0; i < 3000; i++) process.stdout.write(chunk + '\\n');"
  );
  assert.equal(body.status, "success");
  assert.match(body.output, /1 MB limit and was truncated/);
  assert.ok(body.output.length < 2 * 1024 * 1024);
});

test("server stays healthy after the whole suite", async () => {
  const { status, body } = await runCode("javascript", "console.log('still-alive');");
  assert.equal(status, 200);
  assert.equal(body.output.trim(), "still-alive");
});