/**
 * Code execution engine for POST /run.
 *
 * Design goals (see project audit):
 *  - Compilation and execution have SEPARATE, configurable timeouts so a slow
 *    compiler (cold cache) can never be mistaken for a hung program.
 *  - Processes are spawned WITHOUT a shell (argument arrays only), so submitted
 *    code or language names can never be interpreted by cmd.exe.
 *  - Every run executes in its own fresh temp directory, so concurrent runs
 *    cannot interfere and submitted code does not run inside the project
 *    folder (it cannot read .env or project files by relative path).
 *  - Child processes receive an ALLOWLISTED environment (PATH + toolchain
 *    only) — server secrets such as JWT_SECRET, GEMINI_API_KEY and the
 *    MongoDB URI are never exposed to submitted programs.
 *  - On timeout (or output overflow) the whole process tree is killed with
 *    taskkill /T /F so no orphan compilers/interpreters survive.
 *  - stdin is always closed after writing the user's input, so a program that
 *    reads input can never hang waiting for EOF.
 */

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// Phase-specific, configurable limits (override in .env).
const COMPILE_TIMEOUT_MS = clampInt(process.env.COMPILE_TIMEOUT_MS, 60000, 1000, 300000);
const EXECUTION_TIMEOUT_MS = clampInt(process.env.EXECUTION_TIMEOUT_MS, 15000, 1000, 120000);
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB per stream
const KILL_GRACE_MS = 5000; // force-resolve bound after a kill

// Platform-aware defaults: the original Windows paths are kept on Windows;
// other hosts resolve these from PATH (override with GO_BIN / PHP_BIN /
// PYTHON_BIN).
const IS_WINDOWS = process.platform === "win32";
const GO_BIN =
  process.env.GO_BIN ||
  (IS_WINDOWS ? "C:\\Program Files\\Go\\bin\\go.exe" : "go");
const PHP_BIN =
  process.env.PHP_BIN || (IS_WINDOWS ? "C:\\Cphp\\php.exe" : "php");
const PYTHON_BIN =
  process.env.PYTHON_BIN || (IS_WINDOWS ? "python" : "python3");

const SUPPORTED_LANGUAGES = ["javascript", "python", "cpp", "java", "go", "php"];

// Only these variables are handed to child processes. Anything else — most
// importantly JWT_SECRET, GEMINI_API_KEY, MONGODB_URI — stays in the server.
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "JAVA_HOME",
  "GOPATH",
  "GOROOT",
  "GOCACHE",
  "GOMODCACHE",
  "GOPROXY",
  "GOTOOLCHAIN",
  "GOFLAGS",
];

const buildChildEnv = () => {
  const env = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};

// Kill the whole process tree ATOMICALLY.
// Windows: taskkill /T enumerates from the root, so it must finish BEFORE any
// direct kill of the root — killing the root first races taskkill, its
// grandchildren escape (the JVM spawns child processes) holding the stdio
// pipes, `close` never fires and the HTTP request hangs forever.
// POSIX: children are spawned detached (their own process group), so
// kill(-pid) terminates the whole tree at once.
const killTree = (pid) =>
  new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    let done = false;
    const finishKill = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      if (IS_WINDOWS) {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", finishKill);
        killer.on("close", finishKill);
        setTimeout(finishKill, 3000); // never wait on taskkill itself
      } else {
        try {
          process.kill(-pid, "SIGKILL"); // whole process group
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch { /* already dead */ }
        }
        finishKill();
      }
    } catch {
      finishKill();
    }
  }).then(() => {
    // Direct fallback only after the tree kill had its chance.
    try {
      process.kill(pid);
    } catch { /* already dead */ }
  });

/**
 * Run one process phase (compile or execute) with a hard timeout.
 * Never throws; always resolves with a structured record.
 */
const runProcess = ({ command, args, cwd, timeoutMs, stdinData }) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const child = spawn(command, args, {
      cwd,
      env: buildChildEnv(),
      windowsHide: true,
      // On POSIX give every run its own process group so killTree can
      // terminate the whole tree with kill(-pid).
      detached: !IS_WINDOWS,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let graceTimer = null;

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve({
        timedOut,
        overflowed,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        ...extra,
      });
    };

    // After a kill is issued, bound the wait: if an escaped grandchild keeps
    // the stdio pipes open, `close` never fires — force-resolve instead of
    // hanging the HTTP request forever.
    const killAndBound = () => {
      killTree(child.pid);
      if (!graceTimer) {
        graceTimer = setTimeout(() => {
          finish({ exitCode: null, signal: null, forced: true });
        }, KILL_GRACE_MS);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killAndBound();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
      } else if (!overflowed) {
        overflowed = true;
        killAndBound(); // stop a program that floods stdout
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
      } else if (!overflowed) {
        overflowed = true;
        killAndBound();
      }
    });

    // Swallow EPIPE: the program may exit before consuming stdin.
    child.stdin.on("error", () => {});

    child.on("error", (error) => {
      finish({ spawnError: error.message, exitCode: null });
    });

    child.on("close", (code, signal) => {
      finish({ exitCode: code, signal });
    });

    try {
      if (typeof stdinData === "string") {
        child.stdin.write(stdinData.endsWith("\n") ? stdinData : `${stdinData}\n`);
      }
      // Always close stdin — a program blocked on input() must receive EOF
      // instead of waiting forever (this was a guaranteed-timeout bug).
      child.stdin.end();
    } catch {
      // Child may already be gone; the close handler still resolves.
    }
  });

const removeDir = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can briefly lock a just-killed .exe; retry once in the background.
    const retry = setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* give up silently */ }
    }, 2000);
    if (typeof retry.unref === "function") retry.unref();
  }
};

const timeoutMessage = (seconds, phase) =>
  phase === "compile"
    ? `⏱️ Compilation Timed Out\n\nCompilation exceeded ${seconds} seconds and was stopped.`
    : `⏱️ Execution Timed Out\n\nYour program ran for more than ${seconds} seconds and was stopped.`;

const TRUNCATION_NOTICE = "\n⚠️ Program output exceeded the 1 MB limit and was truncated.";

/**
 * Execute submitted source code and return a structured result:
 * { status, output, stdout, stderr, exitCode, timedOut, durationMs }
 *
 * status:
 *   success | compile_error | compile_timeout | runtime_error |
 *   timeout | runtime_unavailable
 */
const executeProgram = async ({ language, code, input }) => {
  const id = randomUUID();
  const runDir = path.join(os.tmpdir(), `ace-run-${id}`);
  fs.mkdirSync(runDir, { recursive: true });

  const totalStartedAt = Date.now();

  try {
    let compilePhase = null;
    let runPhase = null;

    if (language === "javascript") {
      const file = path.join(runDir, `${id}.js`);
      fs.writeFileSync(file, code);
      runPhase = { command: process.execPath, args: [file] };
    } else if (language === "python") {
      const file = path.join(runDir, `${id}.py`);
      fs.writeFileSync(file, code);
      runPhase = { command: PYTHON_BIN, args: [file] };
    } else if (language === "cpp") {
      const file = path.join(runDir, `${id}.cpp`);
      const exe = path.join(runDir, `${id}.exe`);
      fs.writeFileSync(file, code);
      compilePhase = { command: "g++", args: [file, "-o", exe] };
      runPhase = { command: exe, args: [] };
    } else if (language === "java") {
      const file = path.join(runDir, "Main.java");
      fs.writeFileSync(file, code);
      compilePhase = { command: "javac", args: ["-encoding", "UTF-8", "-d", runDir, file] };
      runPhase = { command: "java", args: ["-cp", runDir, "Main"] };
    } else if (language === "go") {
      const file = path.join(runDir, `${id}.go`);
      const exe = path.join(runDir, `${id}.exe`);
      fs.writeFileSync(file, code);
      // Build first so a cold compiler cache only consumes the COMPILE
      // timeout, never the execution timeout.
      compilePhase = { command: GO_BIN, args: ["build", "-o", exe, file] };
      runPhase = { command: exe, args: [] };
    } else if (language === "php") {
      const file = path.join(runDir, `${id}.php`);
      fs.writeFileSync(file, code);
      runPhase = { command: PHP_BIN, args: [file] };
    } else {
      return {
        status: "runtime_unavailable",
        output: "Unsupported Language",
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        durationMs: 0,
      };
    }

    // ---------- Phase 1: compilation ----------
    if (compilePhase) {
      const compiled = await runProcess({
        ...compilePhase,
        cwd: runDir,
        timeoutMs: COMPILE_TIMEOUT_MS,
      });

      if (compiled.spawnError) {
        return {
          status: "runtime_unavailable",
          output: `Compiler/runtime not available on this server: ${compiled.spawnError}`,
          stdout: compiled.stdout,
          stderr: compiled.stderr,
          exitCode: null,
          timedOut: false,
          durationMs: Date.now() - totalStartedAt,
        };
      }

      if (compiled.timedOut) {
        return {
          status: "compile_timeout",
          output: timeoutMessage(COMPILE_TIMEOUT_MS / 1000, "compile"),
          stdout: compiled.stdout,
          stderr: compiled.stderr,
          exitCode: null,
          timedOut: true,
          durationMs: Date.now() - totalStartedAt,
        };
      }

      if (compiled.exitCode !== 0) {
        const details = compiled.stderr || compiled.stdout || "No compiler output.";
        return {
          status: "compile_error",
          output: `Compilation failed (exit code ${compiled.exitCode}):\n\n${details}`,
          stdout: compiled.stdout,
          stderr: compiled.stderr,
          exitCode: compiled.exitCode,
          timedOut: false,
          durationMs: Date.now() - totalStartedAt,
        };
      }
    }

    // ---------- Phase 2: execution ----------
    const ran = await runProcess({
      ...runPhase,
      cwd: runDir,
      timeoutMs: EXECUTION_TIMEOUT_MS,
      stdinData: typeof input === "string" ? input : undefined,
    });

    if (ran.spawnError) {
      return {
        status: "runtime_unavailable",
        output: `Runtime not available on this server: ${ran.spawnError}`,
        stdout: ran.stdout,
        stderr: ran.stderr,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - totalStartedAt,
      };
    }

    if (ran.overflowed) {
      const partial = ran.stdout.length > 0 ? ran.stdout : ran.stderr;
      return {
        status: "success",
        output: partial + TRUNCATION_NOTICE,
        stdout: ran.stdout,
        stderr: ran.stderr,
        exitCode: ran.exitCode,
        timedOut: false,
        truncated: true,
        durationMs: Date.now() - totalStartedAt,
      };
    }

    if (ran.timedOut) {
      return {
        status: "timeout",
        output: timeoutMessage(EXECUTION_TIMEOUT_MS / 1000, "run"),
        stdout: ran.stdout,
        stderr: ran.stderr,
        exitCode: null,
        timedOut: true,
        durationMs: Date.now() - totalStartedAt,
      };
    }

    if (ran.exitCode !== 0) {
      const details =
        ran.stderr || ran.stdout || `Program exited with exit code ${ran.exitCode}.`;
      return {
        status: "runtime_error",
        output: details,
        stdout: ran.stdout,
        stderr: ran.stderr,
        exitCode: ran.exitCode,
        timedOut: false,
        durationMs: Date.now() - totalStartedAt,
      };
    }

    return {
      status: "success",
      output: ran.stdout,
      stdout: ran.stdout,
      stderr: ran.stderr,
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - totalStartedAt,
    };
  } finally {
    removeDir(runDir);
  }
};

module.exports = {
  executeProgram,
  SUPPORTED_LANGUAGES,
  COMPILE_TIMEOUT_MS,
  EXECUTION_TIMEOUT_MS,
};