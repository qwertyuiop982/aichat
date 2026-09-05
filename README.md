# aiclaw

OpenAI-compatible AI chat client for Termux. The project includes the original Node.js CLI and a Qt 6 Widgets GUI in C++. Both clients share configuration and conversation storage.

## Qt GUI

Sources: `main.cpp`, `CMakeLists.txt`
Binary: `build/aiclaw-gui`
Configuration: `~/.aiclaw/config.json`
Sessions: `~/.aiclaw/sessions/*.jsonl`

### Build and start

```sh
cd ~/aichat
cmake -S . -B build -G Ninja
cmake --build build -j2
./build/aiclaw-gui
```

The GUI requires a Qt display backend, normally Termux:X11. Startup-only verification without a display:

```sh
QT_QPA_PLATFORM=offscreen ./build/aiclaw-gui
```

### GUI features

- User messages are right-aligned blue bubbles; AI replies are left-aligned bubbles.
- `reasoning_content` and `<think>...</think>` are extracted from the visible answer and shown in a collapsible Thinking section in the AI bubble.
- Existing JSONL conversations can be selected from the sidebar. `+ New conversation` creates a session.
- User and final AI messages are persisted in `~/.aiclaw/sessions`.
- **Settings** selects an existing configuration and edits API URL, key, model, thinking control, and system prompt.

### Tool controls

Each configuration has two independent switches in **Settings**:

- **Enable tool calling**: permits the GUI to parse and execute a model tool request.
- **Inject tool prompt**: appends the tool protocol and tool list to the system message. It is available only when tool calling is enabled.

With tool calling enabled, the GUI asks the model to wrap reasoning in `<think>...</think>`. A turn is capped at six tool rounds.

Supported GUI tools: `list_dir(path)`, `read_file(path)`, `grep_search(pattern, path)`, and `shell(command)`.

A model requests a tool with a fenced `tool_call` JSON block:

```text
```tool_call
{"name":"read_file","arguments":{"path":"/path/to/file"}}
```
```

`shell` uses `sh -lc` under the Termux user account. Enable tool calling only for trusted providers and prompts.

## Shared configuration

GUI and CLI use `~/.aiclaw/config.json`. Existing CLI configurations remain compatible; GUI-only fields are optional:

```json
{
  "current": "MiniMax",
  "currentSession": "default",
  "configs": {
    "MiniMax": {
      "baseURL": "https://example.com/v1/chat/completions",
      "apiKey": "sk-...",
      "model": "model-name",
      "thinking": "enabled",
      "system": "",
      "toolsEnabled": false,
      "toolPromptEnabled": false
    }
  }
}
```

## Node.js CLI

The GUI does not replace the CLI:

```sh
cd ~/aichat
node bin/aiclaw.js --help
node bin/aiclaw.js config list
node bin/aiclaw.js input user "Hello"
node bin/aiclaw.js session list
```

The CLI implementation is under `bin/` and `lib/`; it has its own provider, session, and tool-loop support.

## Project layout

```text
aichat/
├── bin/aiclaw.js       # Node.js CLI entry
├── lib/                # CLI modules and tools
├── main.cpp            # Qt GUI
├── CMakeLists.txt      # Qt GUI CMake build
├── build/aiclaw-gui    # Built GUI executable
├── package.json
└── aiapi.md
```
