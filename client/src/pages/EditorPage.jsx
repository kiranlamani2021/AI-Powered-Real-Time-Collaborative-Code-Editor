import Draggable from "react-draggable";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import Editor from "@monaco-editor/react";
import randomColor from "randomcolor";
import { io } from "socket.io-client";
import { useParams } from "react-router-dom";
import axios from "axios";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import Peer from "simple-peer";
import CodePilotMessage from "../components/CodePilotMessage";

const authConfig = () => ({
  headers: {
    Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
  },
});

const socket = io(
  "http://localhost:5000",
  {
    transports: ["websocket"],
    auth: {
      token: localStorage.getItem("token"),
    },
    autoConnect: false,
  }
);

const defaultFileContent = {
  javascript: "// Start coding here",
  python: "# Start coding here",
  java: "// Start coding here",
  cpp: "// Start coding here",
  go: "// Start coding here",
  php: "// Start coding here",
  typescript: "// Start coding here",
  html: "<!-- Start coding here -->",
  css: "/* Start coding here */",
  json: "{}",
  sql: "-- Start coding here",
  yaml: "# Start coding here",
};

const languageFromFileName = (fileName) => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const languages = {
    js: "javascript",
    jsx: "javascript",
    py: "python",
    java: "java",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    go: "go",
    php: "php",
    ts: "typescript",
    tsx: "typescript",
    html: "html",
    htm: "html",
    css: "css",
    json: "json",
    sql: "sql",
    yml: "yaml",
    yaml: "yaml",
  };

  return languages[extension] || "javascript";
};

const initialContentFor = (fileName, fileLanguage) => {
  const resolvedLanguage = fileLanguage || languageFromFileName(fileName);
  return defaultFileContent[resolvedLanguage] || defaultFileContent.javascript;
};

const initializeEmptyFiles = (fileSet, languages) =>
  Object.fromEntries(
    Object.entries(fileSet || {}).map(([fileName, content]) => [
      fileName,
      typeof content === "string" && content.trim()
        ? content
        : initialContentFor(fileName, languages[fileName]),
    ])
  );

function EditorPage() {

  const { roomId } = useParams();
  const username =
    localStorage.getItem("username") || "Guest";

  const [files, setFiles] = useState({
    "main.js": "// Start coding here",
  });

  const [activeFile, setActiveFile] =
    useState("main.js");

  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  // Synchronous guard: React state updates are async, so two clicks in the
  // same tick could both pass the `isRunning` check and fire duplicate runs.
  const isRunningRef = useRef(false);
  const [filePrompt, setFilePrompt] = useState(null);
  const [filePromptValue, setFilePromptValue] = useState("");
  const [filePromptError, setFilePromptError] = useState("");
  const [fileNotice, setFileNotice] = useState("");
  // "loading" | "ready" | "failed" — saving is only allowed once the saved
  // project has been restored, so the default state can never overwrite it.
  const [projectLoadState, setProjectLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [saveMessage, setSaveMessage] = useState(null);
  // Edits the user makes before the initial load settles (fileName -> content).
  const preLoadEditsRef = useRef(null);
  // Guards against overlapping / out-of-order save requests.
  const saveInFlightRef = useRef(false);
  // Increments per mount-effect run so a stale load can never apply to a
  // newer room's state.
  const loadRunRef = useRef(0);

  // Reset load/save state when the room changes (adjust-during-render pattern)
  // so the previous room's "ready" state can never authorize a save of stale
  // files into the new room.
  const [prevRoomId, setPrevRoomId] = useState(roomId);
  if (prevRoomId !== roomId) {
    setPrevRoomId(roomId);
    setProjectLoadState("loading");
    setLoadError("");
    setSaveMessage(null);
  }
  const [messages, setMessages] = useState([]);
  const [chatMessage, setChatMessage] =
    useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiChats, setAiChats] = useState([]);
  const [showAI, setShowAI] = useState(true);
  const [aiGeneratedCode, setAiGeneratedCode] = useState("");
  const aiChatBottomRef = useRef(null);
  const aiChatAreaRef = useRef(null);
  const [editorInstance, setEditorInstance] = useState(null);

  useEffect(() => {
  if (!editorInstance) return;

  editorRef.current = editorInstance;

  const disposable =
    editorInstance.onDidChangeCursorPosition((event) => {
      socket.emit("cursor-change", {
        roomId,
        cursorPosition: event.position,
        username,
      });
    });

  return () => disposable.dispose();
}, [editorInstance, roomId, username]);

  const insertCodeSnippet = (snippet) => {
    if (!snippet || !snippet.trim()) return;

    const currentCode = editorRef.current
      ? editorRef.current.getValue()
      : files[activeFile] || "";

    const newCode = currentCode
      ? currentCode + "\n\n" + snippet.trim()
      : snippet.trim();

    setFiles((prev) => ({
      ...prev,
      [activeFile]: newCode,
    }));

    if (editorRef.current) {
      editorRef.current.setValue(newCode);
    }

    socket.emit("code-change", {
      roomId,
      fileName: activeFile,
      code: newCode,
    });
  };

  const insertAIIntoEditor = () => {
    if (aiGeneratedCode && aiGeneratedCode.trim()) {
      insertCodeSnippet(aiGeneratedCode);
      setAiGeneratedCode("");
    }
  };

  useEffect(() => {
    const chatArea = aiChatAreaRef.current;

    if (showAI && chatArea) {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [aiChats, aiLoading, showAI]);
  const [users, setUsers] =
    useState([]);
  const [input, setInput] =
    useState("");
  const [fileLanguages, setFileLanguages] = useState({
    "main.js": "javascript",
  });
  const editorRef = useRef(null);
  const remoteDecorationRef = useRef([]);
  const remoteCursorColorsRef = useRef({});
  const myVideo = useRef();
  const peersRef = useRef({});
  const videoRefs = useRef({});
  const streamRef = useRef(null);

  const [stream, setStream] = useState(null);

  const [inVideoCall, setInVideoCall] = useState(false);
  const [videoParticipants, setVideoParticipants] = useState([]);

  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const dragRef = useRef(null);
  const hasJoined = useRef(false);

  function createVideoPeer(
    userId,
    initiator,
    userName,
    incomingSignal = null
  ) {
    const currentStream =
      streamRef.current;

    if (!currentStream) {
      console.log(
        "No local video stream available."
      );
      return;
    }

    if (peersRef.current[userId]) {
      return;
    }

    const peer = new Peer({
      initiator,
      trickle: false,
      stream: currentStream,
    });

    peersRef.current[userId] = peer;

    peer.on("signal", (signal) => {
      socket.emit("video-signal", {
        to: userId,
        signal,
      });
    });

    peer.on("stream", (remoteStream) => {
      setVideoParticipants((prev) =>
        prev.map((participant) =>
          participant.socketId === userId
            ? {
              ...participant,
              stream: remoteStream,
            }
            : participant
        )
      );
    });

    peer.on("error", (error) => {
      console.log(
        "Video peer error:",
        error
      );
    });

    peer.on("close", () => {
      delete peersRef.current[userId];

      setVideoParticipants((prev) =>
        prev.filter(
          (participant) =>
            participant.socketId !== userId
        )
      );
    });

    if (incomingSignal) {
      peer.signal(incomingSignal);
    }
  }

  useEffect(() => {

    socket.auth = { token: localStorage.getItem("token") };
    hasJoined.current = false;
    socket.connect();

    const runId = ++loadRunRef.current;
    const isCurrentRun = () => loadRunRef.current === runId;

    // Reset the pre-load edit buffer for this run (refs belong in effects).
    preLoadEditsRef.current = null;

    socket.on(
      "receive-message",
      ({ message, username }) => {

        setMessages((prev) => [
          ...prev,
          {
            username,
            message,
          },
        ]);
      }
    );

    socket.on(
      "cursor-update",
      ({ cursorPosition, username }) => {

        const color =
          remoteCursorColorsRef.current[username] ||
          (remoteCursorColorsRef.current[username] =
            randomColor());

        if (!editorRef.current) return;

        const cursorClass =
          `remote-cursor-${color.replace("#", "")}`;

        if (!document.getElementById(cursorClass)) {
          const style = document.createElement("style");

          style.id = cursorClass;

          style.innerHTML = `
        .${cursorClass} {
          border-left: 2px solid ${color};
          margin-left: -1px;
        }
      `;

          document.head.appendChild(style);
        }

        const decorations = [
          {
            range: new window.monaco.Range(
              cursorPosition.lineNumber,
              cursorPosition.column,
              cursorPosition.lineNumber,
              cursorPosition.column
            ),

            options: {
              afterContentClassName: cursorClass,

              stickiness:
                window.monaco.editor.TrackedRangeStickiness
                  .NeverGrowsWhenTypingAtEdges,
            },
          },
        ];

        remoteDecorationRef.current =
          editorRef.current.deltaDecorations(
            remoteDecorationRef.current,
            decorations
          );
      }
    );

    if (!hasJoined.current) {

      socket.emit(
        "join-room",
        {
          roomId,
          username,
        }
      );

      hasJoined.current = true;
    }

    const applyLoadedProject = (data) => {

      if (!isCurrentRun()) return; // stale load from a previous room/visit

      if (!data) {
        // No saved project for this room yet — the default state is correct.
        setProjectLoadState("ready");
        return;
      }

      const loadedLanguages = data.fileLanguages || {
        "main.js": "javascript",
      };
      const loadedFiles = initializeEmptyFiles(
        data.files,
        loadedLanguages
      );

      // Keep anything the user typed/created while the load was in flight so a
      // slow load never discards fresh edits (it must still win over defaults).
      const preLoadEdits = preLoadEditsRef.current;
      const finalFiles = preLoadEdits
        ? { ...loadedFiles, ...preLoadEdits }
        : loadedFiles;

      setFiles(finalFiles);
      setFileLanguages(loadedLanguages);

      setActiveFile((prev) => {
        if (preLoadEdits && finalFiles[prev] !== undefined) return prev;
        if (data.activeFile && finalFiles[data.activeFile] !== undefined) {
          return data.activeFile;
        }
        return Object.keys(finalFiles)[0] || "main.js";
      });

      setProjectLoadState("ready");
      setLoadError("");
    };

    const loadProject = async () => {

      for (let attempt = 0; attempt < 3; attempt += 1) {

        if (!isCurrentRun()) return;

        try {

          const response =
            await axios.get(
              `http://localhost:5000/project/load/${roomId}`,
              authConfig()
            );

          applyLoadedProject(response.data);
          return;

        } catch (error) {

          if (!isCurrentRun()) return;

          const status = error?.response?.status;
          console.log("[Project Load Failed]", status || error?.message || error);

          // Access/permission problems will not fix themselves — stop retrying.
          if (status === 403 || status === 400) break;

          await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        }
      }

      if (!isCurrentRun()) return;

      // Load never succeeded: refuse to autosave, otherwise the default
      // "main.js" state would overwrite the real saved project.
      setProjectLoadState("failed");
      setLoadError(
        "Could not load the saved project. Saving is disabled to protect your data — check the backend connection and reload the page."
      );
    };

    loadProject();

    socket.on(
      "receive-code",
      ({ fileName, code }) => {

        setFiles((prev) => ({
          ...prev,
          [fileName]: code,
        }));
      }
    );

    socket.on(
      "file-created",
      ({ fileName }) => {

        setFiles((prev) => {

          if (
            Object.prototype.hasOwnProperty.call(prev, fileName)
          ) {
            return prev;
          }

          return {
            ...prev,
            [fileName]: initialContentFor(fileName),
          };
        });

        setActiveFile(fileName);
      }
    );

    socket.on(
      "file-renamed",
      ({
        oldFileName,
        newFileName,
      }) => {

        setFiles((prev) => {

          const updatedFiles = {
            ...prev,
          };

          updatedFiles[newFileName] =
            updatedFiles[oldFileName];

          delete updatedFiles[
            oldFileName
          ];

          return updatedFiles;
        });

        setActiveFile((prev) =>
          prev === oldFileName
            ? newFileName
            : prev
        );
      }
    );

    socket.on(
      "file-deleted",
      ({ fileName }) => {

        setFiles((prev) => {

          const updatedFiles = {
            ...prev,
          };

          delete updatedFiles[fileName];

          const remainingFiles =
            Object.keys(updatedFiles);

          setActiveFile((current) => {

            if (current === fileName) {

              return (
                remainingFiles[0] || ""
              );
            }

            return current;
          });

          return updatedFiles;
        });
      }
    );

    socket.on(
      "file-switched",
      ({ fileName }) => {

        setActiveFile(fileName);
      }
    );

    socket.on(
      "language-changed",
      ({ fileName, language }) => {
        setFileLanguages((prev) => ({
          ...prev,
          [fileName]: language,
        }));
      }
    );

    socket.on(
      "code-output",
      ({ output }) => {

        setOutput(output);
      }
    );

    socket.on(
      "input-updated",
      ({ input }) => {

        setInput(input);
      }
    );

    socket.on(
      "users-update",
      (usersList) => {

        setUsers(usersList);
      }
    );
    // ================= GROUP VIDEO CALL LISTENERS =================

    function handleExistingVideoUsers(users) {
      users.forEach((user) => {
        setVideoParticipants((prev) => {
          if (
            prev.some(
              (participant) =>
                participant.socketId === user.socketId
            )
          ) {
            return prev;
          }

          return [
            ...prev,
            {
              socketId: user.socketId,
              username: user.username,
              stream: null,
              cameraOn: true,
              micOn: true,
            },
          ];
        });

        // New user creates connections to existing users
        createVideoPeer(
          user.socketId,
          true,
          user.username
        );
      });
    }


    function handleVideoUserJoined({
      socketId,
      username,
    }) {
      setVideoParticipants((prev) => {
        if (
          prev.some(
            (participant) =>
              participant.socketId === socketId
          )
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            socketId,
            username,
            stream: null,
            cameraOn: true,
            micOn: true,
          },
        ];
      });
    }


    function handleVideoSignal({
      from,
      signal,
      username,
    }) {
      if (peersRef.current[from]) {
        peersRef.current[from].signal(signal);
        return;
      }

      setVideoParticipants((prev) => {
        if (
          prev.some(
            (participant) =>
              participant.socketId === from
          )
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            socketId: from,
            username: username || "Guest",
            stream: null,
            cameraOn: true,
            micOn: true,
          },
        ];
      });

      // New user accepts the WebRTC connection
      createVideoPeer(
        from,
        false,
        username || "Guest",
        signal
      );
    }

    function handleVideoStateChange({
      socketId,
      cameraOn,
      micOn,
    }) {
      setVideoParticipants((prev) =>
        prev.map((participant) =>
          participant.socketId === socketId
            ? {
              ...participant,
              cameraOn,
              micOn,
            }
            : participant
        )
      );
    }


    function handleVideoUserLeft({
      socketId,
    }) {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].destroy();
        delete peersRef.current[socketId];
      }

      delete videoRefs.current[socketId];

      setVideoParticipants((prev) =>
        prev.filter(
          (participant) =>
            participant.socketId !== socketId
        )
      );
    }


    socket.on(
      "video-existing-users",
      handleExistingVideoUsers
    );

    socket.on(
      "video-user-joined",
      handleVideoUserJoined
    );

    socket.on(
      "video-signal",
      handleVideoSignal
    );

    socket.on(
      "video-state-change",
      handleVideoStateChange
    );

    socket.on(
      "video-user-left",
      handleVideoUserLeft
    );

    return () => {
      socket.disconnect();
      socket.off("receive-message");
      socket.off("cursor-update");

      socket.off("receive-code");
      socket.off("file-created");
      socket.off("file-renamed");
      socket.off("file-deleted");
      socket.off("file-switched");

      socket.off("language-changed");
      socket.off("code-output");
      socket.off("input-updated");
      socket.off("users-update");
      socket.off(
        "video-existing-users",
        handleExistingVideoUsers
      );

      socket.off(
        "video-user-joined",
        handleVideoUserJoined
      );

      socket.off(
        "video-signal",
        handleVideoSignal
      );

      socket.off(
        "video-state-change",
        handleVideoStateChange
      );

      socket.off(
        "video-user-left",
        handleVideoUserLeft
      );
    };

  }, [roomId, username]);

  const handleEditorChange = (value) => {
    const codeValue = value || "";

    if (projectLoadState === "loading") {
      preLoadEditsRef.current = {
        ...(preLoadEditsRef.current || {}),
        [activeFile]: codeValue,
      };
    }

    setFiles((prev) => ({
      ...prev,
      [activeFile]: codeValue,
    }));

    socket.emit("code-change", {
      roomId,
      fileName: activeFile,
      code: codeValue,
    });
  };
  const runCode = async () => {

    if (isRunningRef.current) return;

    isRunningRef.current = true;
    setIsRunning(true);

    try {

      const response = await axios.post(
        "http://localhost:5000/run",
        {
          roomId,
          code: files[activeFile],
          language: fileLanguages[activeFile] || "javascript",
          input,
        }
        , authConfig());

      const programOutput = response?.data?.output;

      setOutput(
        typeof programOutput === "string" && programOutput.length > 0
          ? programOutput
          : "(program finished with no output)"
      );

    } catch (error) {

      const errorData = error?.response?.data;

      const serverMessage =
        (typeof errorData?.output === "string" && errorData.output) ||
        (typeof errorData?.message === "string" && errorData.message) ||
        "";

      if (error?.response) {

        setOutput(
          serverMessage ||
            `Code execution failed (HTTP ${error.response.status}).`
        );

      } else {

        setOutput(
          "Could not reach the code execution server at http://localhost:5000. Please make sure the backend is running."
        );
      }

    } finally {

      isRunningRef.current = false;
      setIsRunning(false);
    }
  };

  const switchFile = (file) => {

    setActiveFile(file);

    const fileLanguage = fileLanguages[file] || languageFromFileName(file);

    if (!files[file]?.trim()) {
      const content = initialContentFor(file, fileLanguage);
      setFiles((prev) => ({
        ...prev,
        [file]: content,
      }));
    }

    socket.emit("switch-file", {
      roomId,
      fileName: file,
    });
  };

  const openFilePrompt = (mode, targetFile = "") => {
    setFilePrompt({ mode, targetFile });
    setFilePromptValue(mode === "rename" ? targetFile : "");
    setFilePromptError("");
    setFileNotice("");
  };

  const closeFilePrompt = () => {
    setFilePrompt(null);
    setFilePromptError("");
  };

  const isValidFileName = (fileName) => /^[\w.-]+$/.test(fileName);

  const submitFilePrompt = () => {

    const newFileName = filePromptValue.trim();

    if (!newFileName) {
      setFilePromptError("Enter a file name.");
      return;
    }

    if (!isValidFileName(newFileName)) {
      setFilePromptError(
        "Use only letters, numbers, dots, dashes and underscores."
      );
      return;
    }

    if (
      filePrompt.mode === "rename" &&
      newFileName === filePrompt.targetFile
    ) {
      closeFilePrompt();
      return;
    }

    if (Object.prototype.hasOwnProperty.call(files, newFileName)) {
      setFilePromptError(`${newFileName} already exists.`);
      return;
    }

    if (filePrompt.mode === "rename") {
      renameFile(filePrompt.targetFile, newFileName);
    } else {
      createNewFile(newFileName);
    }

    closeFilePrompt();
  };

  const createNewFile = (fileName) => {

    const newFileLanguage = languageFromFileName(fileName);
    const newFileContent = initialContentFor(fileName, newFileLanguage);

    if (projectLoadState === "loading") {
      preLoadEditsRef.current = {
        ...(preLoadEditsRef.current || {}),
        [fileName]: newFileContent,
      };
    }

    setFiles((prev) => ({
      ...prev,
      [fileName]: newFileContent,
    }));

    setActiveFile(fileName);

    setFileLanguages((prev) => ({
      ...prev,
      [fileName]: newFileLanguage,
    }));

    socket.emit("new-file", {
      roomId,
      fileName,
    });

    socket.emit("switch-file", {
      roomId,
      fileName,
    });
  };

  const renameFile = (oldFileName, newFileName) => {

    const updatedFiles = {
      ...files,
    };

    updatedFiles[newFileName] =
      updatedFiles[oldFileName];

    delete updatedFiles[oldFileName];

    setFiles(updatedFiles);
    setFileLanguages((prev) => ({
      ...prev,
      [newFileName]: prev[oldFileName] || "javascript",
      [oldFileName]: undefined,
    }));

    if (activeFile === oldFileName
    ) {

      setActiveFile(
        newFileName
      );
    }

    socket.emit("rename-file", {
      roomId,
      oldFileName,
      newFileName,
    });
  };
  const deleteFile = (fileName) => {
    if (Object.keys(files).length <= 1) {
      setFileNotice("Cannot delete the last file — a project needs at least one file.");
      return;
    }

    setFileNotice("");

    const updatedFiles = { ...files };

    delete updatedFiles[fileName];

    setFiles(updatedFiles);
    setFileLanguages((prev) => {
      const updated = { ...prev };
      delete updated[fileName];
      return updated;
    });

    const remainingFiles =
      Object.keys(updatedFiles);

    if (!updatedFiles[activeFile] && remainingFiles.length > 0) {

      setActiveFile(
        remainingFiles[0]
      );
    }

    socket.emit("delete-file", {
      roomId,
      fileName,
    });
  };
  const saveProject = useCallback(async (isManual = false) => {

    // Never write before the saved project has been restored — this is what
    // previously let the default "main.js" state overwrite a real project.
    if (projectLoadState !== "ready") {
      if (isManual) {
        setSaveMessage({
          ok: false,
          text:
            projectLoadState === "failed"
              ? "Save blocked: the saved project could not be loaded."
              : "Save blocked: the project is still loading.",
        });
      }
      return;
    }

    // Skip this tick if a save is already in flight to avoid overlapping,
    // out-of-order writes (an older response landing after a newer one).
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;

    try {

      await axios.post(
        "http://localhost:5000/project/save",
        {
          roomId,
          files,
          activeFile,
          fileLanguages,
        },
        authConfig()
      );

      if (isManual) setSaveMessage({ ok: true, text: "Project saved." });
      else setSaveMessage((prev) => (prev && !prev.ok ? null : prev));

      console.log("Project Auto Saved");

    } catch (error) {
      console.log("Save Failed", error?.response?.data?.error || error?.message || error);
      setSaveMessage({
        ok: false,
        text:
          error?.response?.status === 403
            ? "Save denied: you don't have access to this room."
            : "Save failed — check the backend connection. Your changes are not persisted.",
      });
    } finally {
      saveInFlightRef.current = false;
    }
  }, [roomId, files, activeFile, fileLanguages, projectLoadState]);

  const saveProjectRef = useRef(saveProject);

  useEffect(() => {
    saveProjectRef.current = saveProject;
  }, [saveProject]);

  useEffect(() => {

    // A stable interval (previously it was reset on every keystroke because
    // saveProject changed with `files`, so autosave could be starved).
    const interval = setInterval(() => {

      saveProjectRef.current(false);

    }, 5000);

    return () => clearInterval(interval);

  }, []);
  const downloadProject = async () => {

    const zip = new JSZip();

    Object.keys(files).forEach((fileName) => {

      zip.file(
        fileName,
        files[fileName]
      );

    });

    const content =
      await zip.generateAsync({
        type: "blob",
      });

    saveAs(
      content,
      `project-${roomId}.zip`
    );
  };
  const sendMessage = () => {

    if (!chatMessage.trim()) return;

    socket.emit("send-message", {
      roomId,
      message: chatMessage,
      username,
    });

    setChatMessage("");
  };
  const askAI = async (promptText = aiPrompt) => {
    if (!promptText.trim() || aiLoading) return;

    console.log("🚀 AI BUTTON CLICKED");
    console.log("📝 Prompt:", promptText);

    const currentCode = editorRef.current
      ? editorRef.current.getValue()
      : files[activeFile] || "";
    const currentLanguage =
      fileLanguages[activeFile] || languageFromFileName(activeFile);

    console.log("💻 Code sent to CodePilot:", currentCode);
    console.log("📌 Active File:", activeFile);
    console.log("📌 AI Language:", currentLanguage);

    setAiLoading(true);
    setAiGeneratedCode("");

    try {
      console.log("📡 Sending request to backend...");

      const response = await axios.post(
        "http://localhost:5000/ai",
        {
  prompt: promptText,
  code: currentCode,
  language:
    fileLanguages[activeFile] ||
    languageFromFileName(activeFile),
  chats: aiChats,
},
        authConfig()
      );

      console.log("✅ Backend response received");
      console.log("📦 Response data:", response.data);

      const reply = response.data.reply;

      console.log("🤖 AI Reply:", reply);

      // Detect code blocks from AI response
      const codeMatch = reply.match(/```(?:javascript|js|python|py|java|cpp|c\+\+|go|php|html|css|jsx|typescript|ts)?\s*([\s\S]*?)```/i);

      if (codeMatch) {
        const generatedCode = codeMatch[1].trim();

        console.log("💻 Generated Code Detected:", generatedCode);

        setAiGeneratedCode(generatedCode);
      } else {
        setAiGeneratedCode("");
      }

      setAiChats((prev) => [
        ...prev,
        {
          question: promptText,
          answer: reply,
        },
      ]);

      setAiPrompt("");

      console.log("✅ AI chat state updated");
    } catch (error) {
      console.error("❌ AI REQUEST ERROR:", error);

      const errorReply =
        error.response?.data?.reply ||
        "CodePilot could not reach the AI provider. Your workspace is safe. Please try again.";

      setAiChats((prev) => [
        ...prev,
        {
          question: promptText,
          answer: errorReply,
        },
      ]);

      setAiPrompt("");
    } finally {
      console.log("🔄 Setting aiLoading to false");
      setAiLoading(false);
    }
  };
  // ================= GROUP VIDEO CALL FUNCTIONS =================

  const getInitials = (name = "Guest") => {
    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return (
        parts[0][0] +
        parts[parts.length - 1][0]
      ).toUpperCase();
    }

    return name.slice(0, 1).toUpperCase();
  };

  const startVideo = async () => {
    if (streamRef.current) {
      return;
    }

    try {
      const currentStream =
        await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

      streamRef.current = currentStream;
      setStream(currentStream);

      setCameraOn(true);
      setMicOn(true);

      if (myVideo.current) {
        myVideo.current.srcObject = currentStream;
      }

      setInVideoCall(true);

      socket.emit("join-video-call", {
        roomId,
        username,
      });

    } catch (error) {
      console.log(
        "Camera/Microphone error:",
        error
      );

      alert(
        "Camera or microphone permission is required."
      );
    }
  };

  function toggleMicrophone() {
    const currentStream =
      streamRef.current;

    if (!currentStream) return;

    const audioTracks =
      currentStream.getAudioTracks();

    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    const newMicState =
      audioTracks.length > 0
        ? audioTracks[0].enabled
        : false;

    setMicOn(newMicState);

    socket.emit("video-state-change", {
      roomId,
      cameraOn,
      micOn: newMicState,
    });
  };

  const toggleCamera = () => {
    const currentStream =
      streamRef.current;

    if (!currentStream) return;

    const videoTracks =
      currentStream.getVideoTracks();

    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    const newCameraState =
      videoTracks.length > 0
        ? videoTracks[0].enabled
        : false;

    setCameraOn(newCameraState);
    if (newCameraState && myVideo.current) {
      myVideo.current.srcObject = currentStream;

      myVideo.current
        .play()
        .catch((error) => {
          console.log("Camera restart error:", error);
        });
    }

    socket.emit("video-state-change", {
      roomId,
      cameraOn: newCameraState,
      micOn,
    });
  };

  const leaveVideoCall = () => {
    socket.emit("leave-video-call");

    Object.values(
      peersRef.current
    ).forEach((peer) => {
      peer.destroy();
    });

    peersRef.current = {};

    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });
    }

    streamRef.current = null;

    if (myVideo.current) {
      myVideo.current.srcObject = null;
    }

    setStream(null);
    setVideoParticipants([]);
    setInVideoCall(false);
    setCameraOn(true);
    setMicOn(true);
  };
  useEffect(() => {
    if (myVideo.current && stream && cameraOn) {
      myVideo.current.srcObject = stream;

      myVideo.current
        .play()
        .catch((error) => {
          console.log("Local video play error:", error);
        });
    }
  }, [stream, inVideoCall, cameraOn]);

  return (


    <div
      className="editor-workspace"
      style={{
        display: "flex",
        height: "100vh",
        position: "relative",
        overflowY: "auto",
      }}
    >
      {/* ================= GROUP VIDEO CALL ================= */}

      {inVideoCall && (
        <Draggable
          nodeRef={dragRef}
          handle=".video-header"
        >
          <div
            className="video-call-window"
            ref={dragRef}
            style={{
              position: "fixed",
              top: "60px",
              right: "20px",
              width: "520px",
              maxHeight: "75vh",
              background: "#111",
              color: "white",
              borderRadius: "12px",
              padding: "15px",
              zIndex: 9998,
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
            }}
          >
            {/* HEADER */}
            <div
              className="video-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
                cursor: "move",
                userSelect: "none",
              }}
            >
              <div className="video-title-group">
                <span className="video-live-dot" />
                <div>
                  <strong>Live collaboration</strong>
                  <small>Group video room</small>
                </div>
              </div>

              <span className="video-participant-count">
                {videoParticipants.length + 1} participant
                {videoParticipants.length !== 0 ? "s" : ""}
              </span>
            </div>

            {/* VIDEO GRID */}
            <div
              className="video-stage"
              style={{
                display: "grid",
                gridTemplateColumns:
                  videoParticipants.length === 0
                    ? "1fr"
                    : "repeat(2, 1fr)",
                gap: "10px",
                maxHeight: "55vh",
                overflowY: "auto",
              }}
            >

              {/* MY VIDEO */}
              <div
                className="video-tile"
                style={{
                  position: "relative",
                  background: "#222",
                  borderRadius: "10px",
                  minHeight: "160px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >

                <video
                  ref={myVideo}
                  autoPlay
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: cameraOn ? "block" : "none",
                  }}
                />

                {!cameraOn && (
                  <div
                    className="video-avatar"
                    style={{
                      width: "70px",
                      height: "70px",
                      borderRadius: "50%",
                      background: "#2563eb",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "28px",
                      fontWeight: "bold",
                    }}
                  >
                    {getInitials(username)}
                  </div>
                )}
                <div className="video-nameplate"
                  style={{
                    position: "absolute",
                    bottom: "8px",
                    left: "8px",
                    background: "rgba(0,0,0,0.7)",
                    padding: "4px 8px",
                    borderRadius: "5px",
                  }}
                >
                  {username} {micOn ? "🎤" : "🔇"}
                </div>
              </div>

              {/* OTHER USERS */}
              {videoParticipants.map((participant) => (
                <div
                  key={participant.socketId}
                  className="video-tile participant-tile"
                  style={{
                    position: "relative",
                    background: "#222",
                    borderRadius: "10px",
                    minHeight: "160px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >

                  {participant.cameraOn &&
                    participant.stream ? (
                    <video
                      autoPlay
                      playsInline
                      ref={(video) => {
                        if (video) {
                          videoRefs.current[
                            participant.socketId
                          ] = video;

                          video.srcObject =
                            participant.stream;
                        }
                      }}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div className="video-avatar"
                      style={{
                        width: "70px",
                        height: "70px",
                        borderRadius: "50%",
                        background: "#444",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "28px",
                        fontWeight: "bold",
                      }}
                    >
                      {getInitials(
                        participant.username
                      )}
                    </div>
                  )}

                  <div className="video-nameplate"
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: "8px",
                      background: "rgba(0,0,0,0.7)",
                      padding: "4px 8px",
                      borderRadius: "5px",
                    }}
                  >
                    {participant.username}{" "}
                    {participant.micOn
                      ? "🎤"
                      : "🔇"}
                  </div>
                </div>
              ))}
            </div>

            {/* CONTROLS */}
            <div
              className="video-controls"
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "12px",
                marginTop: "15px",
              }}
            >

              <button
                className={`call-control ${micOn ? "is-on" : "is-off"}`}
                onClick={toggleMicrophone}
                title={micOn ? "Mute microphone" : "Unmute microphone"}
                aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                style={{
                  padding: "10px 16px",
                  border: "none",
                  borderRadius: "8px",
                  background: micOn
                    ? "#333"
                    : "#dc2626",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <span className="control-icon" aria-hidden="true">{micOn ? "🎙" : "🔇"}</span>
                <span className="control-text">{micOn ? "Mute" : "Unmute"}</span>
              </button>

              <button
                className={`call-control ${cameraOn ? "is-on" : "is-off"}`}
                onClick={toggleCamera}
                title={cameraOn ? "Turn camera off" : "Turn camera on"}
                aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
                style={{
                  padding: "10px 16px",
                  border: "none",
                  borderRadius: "8px",
                  background: cameraOn
                    ? "#333"
                    : "#dc2626",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <span className="control-icon" aria-hidden="true">{cameraOn ? "▣" : "▧"}</span>
                <span className="control-text">{cameraOn ? "Camera" : "Camera off"}</span>
              </button>

              <button
                className="call-control leave-control"
                onClick={leaveVideoCall}
                title="Leave video call"
                aria-label="Leave video call"
                style={{
                  padding: "10px 16px",
                  border: "none",
                  borderRadius: "8px",
                  background: "#dc2626",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                <span className="control-icon" aria-hidden="true">↗</span>
                <span className="control-text">Leave</span>
              </button>

            </div>

          </div>
        </Draggable>
      )}

      {/* Sidebar */}
      <div
        className="editor-sidebar"
        style={{
          width: "220px",
          background: "#222",
          color: "white",
          padding: "10px",
        }}
      >

        <h2>Files</h2>

        {Object.keys(files).map((file) => (

          <div
            key={file}
            className={`file-row ${activeFile === file ? "is-active" : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background:
                activeFile === file
                  ? "#333"
                  : "transparent",
              marginBottom: "5px",
              padding: "8px",
              borderRadius: "5px",
            }}
          >

            <span
              className="file-name"
              onClick={() => switchFile(file)}
              style={{
                cursor: "pointer",
                flex: 1,
              }}
            >
              {file}
            </span>
            <button
              onClick={() => openFilePrompt("rename", file)}
              style={{
                background: "orange",
                color: "white",
                border: "none",
                cursor: "pointer",
                padding: "2px 8px",
                marginRight: "5px",
              }}
            >
              Rename
            </button>

            <button
              onClick={() => deleteFile(file)}
              style={{
                background: "red",
                color: "white",
                border: "none",
                cursor: "pointer",
                padding: "2px 8px",
              }}
            >
              X
            </button>

          </div>

        ))}

        <button
          onClick={() => openFilePrompt("create")}
          style={{
            marginTop: "10px",
            padding: "10px",
            width: "100%",
            cursor: "pointer",
          }}
        >
          + New File
        </button>

        {fileNotice ? (
          <div
            role="alert"
            style={{
              marginTop: "8px",
              color: "#f0a24b",
              fontSize: "12px",
              lineHeight: 1.4,
            }}
          >
            {fileNotice}
          </div>
        ) : null}

        {filePrompt && (
          <div
            className="file-name-prompt"
            style={{
              marginTop: "8px",
            }}
          >

            <input
              autoFocus
              value={filePromptValue}
              onChange={(event) => {
                setFilePromptValue(event.target.value);
                setFilePromptError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitFilePrompt();
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  closeFilePrompt();
                }
              }}
              placeholder={
                filePrompt.mode === "rename"
                  ? "New file name"
                  : "e.g. main.py"
              }
              aria-label="File name"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px",
                marginBottom: "5px",
                border: "1px solid #555",
                borderRadius: "4px",
                background: "#111",
                color: "white",
              }}
            />

            {filePromptError && (
              <div
                role="alert"
                style={{
                  color: "#ff9d9d",
                  fontSize: "12px",
                  marginBottom: "5px",
                }}
              >
                {filePromptError}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: "6px",
              }}
            >
              <button
                onClick={submitFilePrompt}
                style={{
                  flex: 1,
                  padding: "6px",
                  cursor: "pointer",
                }}
              >
                {filePrompt.mode === "rename" ? "Rename" : "Create"}
              </button>

              <button
                onClick={closeFilePrompt}
                style={{
                  flex: 1,
                  padding: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>

          </div>
        )}

      </div>

      {/* Main Content */}
      <div
        className="editor-main"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "10px",
          overflowY: "auto",
        }}
      >

        {/* Top Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "10px",
            gap: "10px",
          }}
        >

          <h2
            style={{
              color: "white",
              margin: 0,
            }}
          >
            Room: {roomId}
          </h2>

          <div
            className="editor-topbar editor-actions"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            {!inVideoCall && (
              <button className="video-toggle" onClick={startVideo}>
                Join Video
              </button>
            )}

            <button className="ai-toggle" onClick={() => setShowAI((prev) => !prev)}>
              {showAI ? "Hide CodePilot" : "CodePilot AI"}
            </button>

            <select
              value={fileLanguages[activeFile] || "javascript"}
              onChange={(e) => {

                const newLanguage = e.target.value;

                const currentContent = files[activeFile] || "";
                const isGeneratedDefault = Object.values(defaultFileContent)
                  .includes(currentContent.trim());

                if (isGeneratedDefault) {
                  const updatedContent = initialContentFor(activeFile, newLanguage);

                  setFiles((prev) => ({
                    ...prev,
                    [activeFile]: updatedContent,
                  }));

                  socket.emit("code-change", {
                    roomId,
                    fileName: activeFile,
                    code: updatedContent,
                  });
                }

                setFileLanguages((prev) => ({
                  ...prev,
                  [activeFile]: newLanguage,
                }));

                socket.emit(
                  "language-change",
                  {
                    roomId,
                    fileName: activeFile,
                    language: newLanguage,
                  }
                );
              }}
              style={{
                padding: "8px",
                fontSize: "14px",
              }}
            >

              <option value="javascript">
                JavaScript
              </option>

              <option value="python">
                Python
              </option>

              <option value="java">
                Java
              </option>

              <option value="cpp">
                C++
              </option>

              <option value="go">
                Go
              </option>

              <option value="php">
                PHP
              </option>

              <option value="typescript">
                TypeScript
              </option>

              <option value="html">
                HTML
              </option>

              <option value="css">
                CSS
              </option>

              <option value="json">
                JSON
              </option>

              <option value="sql">
                SQL
              </option>

              <option value="yaml">
                YAML
              </option>

            </select>

            <button
              onClick={runCode}
              disabled={isRunning}
              title={isRunning ? "Running..." : "Run Code"}
              style={{
                padding: "8px 16px",
                cursor: isRunning ? "wait" : "pointer",
              }}
            >
              {isRunning ? "Running..." : "Run Code"}
            </button>

            <button
              onClick={() => saveProject(true)}
              disabled={projectLoadState !== "ready"}
              title={
                projectLoadState === "ready"
                  ? "Save Project"
                  : projectLoadState === "failed"
                    ? "Saving disabled: project failed to load"
                    : "Saving disabled: project is loading"
              }
              style={{
                padding: "8px 16px",
                cursor:
                  projectLoadState === "ready" ? "pointer" : "not-allowed",
                opacity: projectLoadState === "ready" ? 1 : 0.55,
              }}
            >
              {projectLoadState === "loading" ? "Loading..." : "Save Project"}
            </button>

            <button
              onClick={downloadProject}
              style={{
                padding: "8px 16px",
                cursor: "pointer",
                background: "#28a745",
                color: "white",
                border: "none",
              }}
            >
              Download Project
            </button>

            {loadError ? (
              <span
                role="alert"
                style={{
                  color: "#f0a24b",
                  fontSize: "12px",
                  maxWidth: "340px",
                  textAlign: "left",
                }}
              >
                {loadError}
              </span>
            ) : null}

            {saveMessage ? (
              <span
                role="alert"
                style={{
                  color: saveMessage.ok ? "#8fd18a" : "#f0883e",
                  fontSize: "12px",
                  maxWidth: "340px",
                  textAlign: "left",
                }}
              >
                {saveMessage.text}
              </span>
            ) : null}

          </div>

        </div>

        {/* Online Users */}
        <div
          className="online-panel"
          style={{
            color: "white",
            marginBottom: "10px",
          }}
        >

          <strong>Online Users:</strong>

          <div
            className="online-list"
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "5px",
              flexWrap: "wrap",
            }}
          >

            {users
              .filter(
                (user) =>
                  user.username !== username
              )
              .map((user, index) => (

                <div
                  key={`${user.username}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    background: "#333",
                    padding: "5px 10px",
                    borderRadius: "5px",
                  }}
                >

                  <span>
                    {user.username}
                  </span>

                </div>

              ))}

          </div>

        </div>

        {/* Editor */}
        <div
          className="code-surface"
          style={{
            marginBottom: "5px",
          }}
        >

          <Editor
            height="35vh"
            language={fileLanguages[activeFile] || "javascript"}
            theme="vs-dark"
            value={files[activeFile]}
            onChange={handleEditorChange}
            options={{
              inlineSuggest: { enabled: true },

              suggest: {
                preview: true,
              },

              parameterHints: {
                enabled: true,
              },

              codeLens: false,

              inlayHints: {
                enabled: "off",
              },

              autoClosingBrackets: "always",
              autoClosingQuotes: "always",
              minimap: { enabled: false },
            }}
           onMount={(editor, monaco) => {
  setEditorInstance(editor);
  window.monaco = monaco;
}}
          />

        </div>
        {/* Chat Section */}
        <div
          className="team-chat"
          style={{
            background: "#111",
            color: "white",
            padding: "10px",
            marginTop: "5px",
            borderTop: "2px solid #333",
          }}
        >

          <h3>Team Chat</h3>

          <div
            style={{
              height: "70px",
              overflowY: "auto",
              background: "#1e1e1e",
              padding: "10px",
              marginBottom: "10px",
            }}
          >

            {messages.map((msg, index) => (

              <div
                key={index}
                style={{
                  marginBottom: "8px",
                }}
              >

                <strong>
                  {msg.username}:
                </strong>{" "}

                {msg.message}

              </div>

            ))}

          </div>

          <div
            style={{
              display: "flex",
              gap: "10px",
            }}
          >

            <input
              type="text"
              value={chatMessage}
              onChange={(e) =>
                setChatMessage(
                  e.target.value
                )
              }
              placeholder="Type message..."
              style={{
                flex: 1,
                padding: "10px",
              }}
            />

            <button
              onClick={sendMessage}
              style={{
                padding: "10px 20px",
                cursor: "pointer",
              }}
            >
              Send
            </button>

          </div>

        </div>
        {/* CODEPILOT AI PANEL */}
        {showAI && (
          <div
            className="ai-panel"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: "400px",
              height: "100vh",
              background: "#181818",
              color: "white",
              zIndex: 10000,
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid #333",
              boxShadow: "-5px 0 20px rgba(0,0,0,0.5)",
            }}
          >

            {/* HEADER */}
            <div
              style={{
                height: "60px",
                padding: "0 16px",
                borderBottom: "1px solid #333",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                boxSizing: "border-box",
              }}
            >
              <strong style={{ fontSize: "18px" }}>
                ⚡CodePilot AI
              </strong>

              <button
                onClick={() => setShowAI(false)}
                style={{
                  background: "transparent",
                  color: "#aaa",
                  border: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* CHAT AREA */}
            <div
              ref={aiChatAreaRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px",
              }}
            >

              {aiChats.length === 0 && !aiLoading && (
                <div
                  style={{
                    textAlign: "center",
                    marginTop: "30px",
                    color: "#aaa",
                  }}
                >
                  <h2
                    style={{
                      color: "white",
                      marginBottom: "8px",
                    }}
                  >
                    <span>
                      <span style={{ fontSize: "28px" }}>⚡</span> CodePilot AI
                    </span>
                  </h2>

                  <p style={{ color: "#9ca3af", marginBottom: "20px", fontSize: "13.5px" }}>
                    Your real-time coding assistant.
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", textAlign: "left" }}>
                    <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Suggested Prompts:
                    </span>
                    {[
                      "Explain this code line by line",
                      "Find bugs and syntax errors",
                      "Suggest improvements & best practices",
                      "Write a binary search algorithm",
                    ].map((suggestion, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => askAI(suggestion)}
                        style={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: "8px",
                          padding: "8px 12px",
                          color: "#e2e8f0",
                          fontSize: "12.5px",
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "background 0.2s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#334155")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#1e293b")}
                      >
                        💡 {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* CHAT MESSAGES */}
              {aiChats.map((chat, index) => (
                <div key={index}>

                  {/* USER MESSAGE */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        background: "#2563eb",
                        color: "white",
                        padding: "10px 14px",
                        borderRadius: "12px",
                        maxWidth: "85%",
                        whiteSpace: "pre-wrap",
                        lineHeight: "1.5",
                        fontSize: "13.5px",
                      }}
                    >
                      {chat.question}
                    </div>
                  </div>

                  {/* AI MESSAGE */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-start",
                      marginBottom: "20px",
                    }}
                  >
                    <div
                      style={{
                        background: "#1e232e",
                        border: "1px solid #2d3748",
                        color: "#eee",
                        padding: "12px 14px",
                        borderRadius: "12px",
                        maxWidth: "95%",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    >
                      <CodePilotMessage
                        content={chat.answer}
                        onInsertCode={insertCodeSnippet}
                      />
                      {index === aiChats.length - 1 && aiGeneratedCode && (
                        <button
                          type="button"
                          onClick={insertAIIntoEditor}
                          style={{
                            marginTop: "10px",
                            padding: "8px 14px",
                            borderRadius: "6px",
                            border: "none",
                            background: "#2563eb",
                            color: "white",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: "500",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          📥 Insert into Editor
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              ))}

              {/* THINKING */}
              {aiLoading && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "#60a5fa",
                    fontSize: "13px",
                    padding: "8px 12px",
                    background: "rgba(37, 99, 235, 0.12)",
                    border: "1px solid rgba(37, 99, 235, 0.25)",
                    borderRadius: "8px",
                    width: "fit-content",
                    marginBottom: "15px",
                  }}
                >
                  <span style={{ fontSize: "14px" }}>⚡</span>
                  <span>CodePilot is thinking...</span>
                </div>
              )}

              {/* Auto-scroll Anchor */}
              <div ref={aiChatBottomRef} />
            </div>

            {/* QUICK ACTIONS */}
            <div
              style={{
                padding: "10px 12px",
                borderTop: "1px solid #333",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  overflowX: "auto",
                  marginBottom: "10px",
                }}
              >

                <button
                  onClick={() =>
                    askAI("Explain this code line by line.")
                  }
                  style={{
                    padding: "6px 10px",
                    background: "#252525",
                    color: "white",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Explain
                </button>

                <button
                  onClick={() =>
                    askAI("Find bugs in this code.")
                  }
                  style={{
                    padding: "6px 10px",
                    background: "#252525",
                    color: "white",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Debug
                </button>

                <button
                  onClick={() =>
                    askAI("Suggest improvements for this code.")
                  }
                  style={{
                    padding: "6px 10px",
                    background: "#252525",
                    color: "white",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Improve
                </button>

              </div>

              {/* INPUT */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "8px",
                  background: "#252525",
                  border: "1px solid #444",
                  borderRadius: "10px",
                  padding: "8px",
                }}
              >

                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();

                      if (!aiLoading && aiPrompt.trim()) {
                        askAI();
                      }
                    }
                  }}
                  placeholder="Ask CodePilot about your code..."
                  style={{
                    flex: 1,
                    height: "45px",
                    background: "transparent",
                    color: "white",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    fontSize: "14px",
                    fontFamily: "inherit",
                  }}
                />

                <button
                  onClick={() => askAI()}
                  disabled={aiLoading || !aiPrompt.trim()}
                  style={{
                    width: "40px",
                    height: "40px",
                    background:
                      aiLoading || !aiPrompt.trim()
                        ? "#444"
                        : "#2563eb",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor:
                      aiLoading || !aiPrompt.trim()
                        ? "not-allowed"
                        : "pointer",
                    fontSize: "18px",
                  }}
                >
                  ➤
                </button>

              </div>

              <div
                style={{
                  textAlign: "center",
                  color: "#666",
                  fontSize: "11px",
                  marginTop: "6px",
                }}
              >
                Enter to send • Shift + Enter for new line
              </div>

            </div>

          </div>
        )}

        {/* Output Section */}
        <div
          className="output-panel"
          style={{
            background: "black",
            color: "lime",
            padding: "10px",
            height: "180px",
            overflowY: "auto",
            marginTop: "5px",
            borderTop: "2px solid #333",
          }}
        >

          {(() => {

            const executableLanguages = [
              "javascript",
              "python",
              "cpp",
              "java",
              "go",
              "php",
            ];
            const needsInput = executableLanguages.includes(
              fileLanguages[activeFile] || "javascript"
            );

            return needsInput ? (

              <>

                <h3>Input:</h3>

                <textarea
                  value={input}
                  onChange={(e) => {

                    setInput(
                      e.target.value
                    );

                    socket.emit(
                      "input-change",
                      {
                        roomId,
                        input:
                          e.target.value,
                      }
                    );
                  }}
                  placeholder="Enter program input here..."
                  style={{
                    width: "100%",
                    height: "80px",
                    marginBottom: "10px",
                    background: "#111",
                    color: "white",
                    padding: "10px",
                    border:
                      "1px solid #333",
                  }}
                />

              </>

            ) : null;

          })()}

          <h3>Output:</h3>

          <pre>{output}</pre>

        </div>

      </div>

    </div>
  );
}

export default EditorPage;