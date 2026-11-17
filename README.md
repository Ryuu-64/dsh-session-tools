# dsh-session-tools · Cross-session tasks for DeepSeek Harness

English | [简体中文](https://github.com/Ryuu-64/dsh-session-tools/blob/main/README.zh-CN.md)

Ask the AI in [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) to start a separate conversation, give it a task, and bring the result back to your current chat.

![DSH’s Chinese interface showing a new conversation card, the SQLite recommendation, and the related conversation in the right sidebar](https://raw.githubusercontent.com/Ryuu-64/dsh-session-tools/main/docs/screenshots/session-create-card.png)

*DSH Web `0.2.2-rc.3` in Chinese. The card opens the new SQLite and PostgreSQL conversation, which also appears in the right sidebar.*

## Install

| Source | Supported DSH versions | Node.js |
| --- | --- | --- |
| npm `0.8.0` | `0.2.0-rc.2` | `22.19+` on Node 22, or Node 24 |
| Current GitHub source, unreleased | `0.2.0-rc.2`, `0.2.2-rc.3` | `0.2.2-rc.3` requires Node `24.9.0+` on Node 24 |

You’ll need a working DSH setup and `pnpm` available in your terminal. Install into the same profile you use to run DSH. This command installs the published `0.8.0` release in the `web` profile for DSH `0.2.0-rc.2`.

```sh
dsh plugin --profile web add @ryuu-64/dsh-session-tools@0.8.0
```

For DSH `0.2.2-rc.3` or profile-wide communication defaults, package and install the current GitHub source. Create a folder outside the checkout for plugin archives and replace `/path/to/plugin-archives` below with its absolute path. Keep the archive there after installation so the profile can still find it.

```sh
git clone https://github.com/Ryuu-64/dsh-session-tools.git
cd dsh-session-tools
npm pack --ignore-scripts --pack-destination "/path/to/plugin-archives"
dsh plugin --profile web add "/path/to/plugin-archives/ryuu-64-dsh-session-tools-0.8.0.tgz" --ignore-scripts
```

Use the filename printed by `npm pack`, and restart DSH after installing.

On a host with native plugin updates, check registry-installed releases under **Plugins → Session Tools → Versions → Check again**. For a source installation, pack the updated source and reinstall from the new archive. [Installation guide (Chinese)](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/installation.md)

## Delegate your first task

In a DSH conversation, try:

> Start a conversation called “SQLite vs. PostgreSQL”. Ask it to compare both databases for a local budgeting app used by one person, then bring back its recommendation.

Approve the request if DSH prompts you. Once the new conversation finishes, the AI can bring its answer back to the original chat. Click the conversation name in the creation card (「已创建会话」) to open it and see the full exchange. For a follow-up, ask the AI to find the conversation by title and tell it what to do next.

Include the background, file paths, and expected result in the task. The new conversation starts with the task text you provide.

## Communication settings

- **For one conversation.** Open the session panel from the chat header or use the conversation’s **…** menu. Sending and receiving are separate switches.
- **For the whole profile (current source).** Open **Plugins**, find **Session Tools**, and select **Configure** on the component row. Both defaults start on. Saved defaults apply to conversations without their own settings and survive restarting DSH.

Turning a switch off blocks new messages in that direction. Work already received can continue. Turning off sending also blocks creation of a session with a first message. Tasks can be sent between regular conversations, and DSH handles approvals. If a wait times out, ask the AI to check the same task again to avoid sending it twice. [Communication and wait details (Chinese)](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/tool-reference.md)

## Further reading and feedback

- [Installation, updates, and removal (Chinese)](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/installation.md) · [Host compatibility (Chinese)](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/compatibility.md) · [Tool and receipt reference (Chinese)](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/tool-reference.md)
- [Open an issue](https://github.com/Ryuu-64/dsh-session-tools/issues) with your DSH, Node.js, and plugin versions, your installation source, and steps to reproduce the problem. Remove API keys and private conversation text before posting. QQ discussion group `1129212995`.

[MIT license](https://github.com/Ryuu-64/dsh-session-tools/blob/main/LICENSE)
