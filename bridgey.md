---
title: bridgey
type: moc
parent: "[[Repos]]"
aliases: [bridgey]
author: wils
created: 2026-04-27
tags:
  - repo
  - claude-code
---

# bridgey

> [!abstract] What this is
> Inter-agent communication for Claude Code via the A2A protocol — each instance becomes both an A2A client and server, forming a mesh for multi-agent collaboration.

Lives at `~/projects/personal/bridgey/` and surfaces into the vault via Folder Bridge at `Resources/Repos/personal/bridgey`. The core plugin handles agent registration and message routing; companion plugins add Discord integration and Coolify-based deployment.

Key sub-areas: the `bridgey` core plugin (add-agent, setup, status, tailscale-scan, tailscale-setup skills), `bridgey-discord` (access + configure), and `bridgey-deploy` (coolify, deploy, remote-status, sync).

## Quick start

- [[Resources/Repos/personal/bridgey/CLAUDE|CLAUDE]] — harness rules and conventions
- [[Resources/Repos/personal/bridgey/README|README]] — public overview

## Knowledge map

```folder-overview
title: ""
showTitle: false
depth: 3
includeTypes: [folder, markdown]
style: list
sortBy: name
sortByAsc: true
showFolderNotes: false
```

## See also

- [[Repos]]
