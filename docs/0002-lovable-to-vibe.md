# 0002 — Lovable-type users become vibe coders

**Status:** product intent (2026-08-17)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.

A Lovable-type user can describe an app and get a UI. They are not yet a vibe
coder in Shippin’s sense: they paste API keys into a prompt, they have no
private network, and they have no real editor/runtime they own.

Vaultix is the first habit we teach. Zuul is the second. DevForge is the third.

```text
Lovable prompt + pasted key
        ↓  lessons
Vaultix   ← keys live here, never in chat
Zuul      ← phone + devices on their mesh
DevForge  ← real editor, terminal events, not a screenshot loop
Shippin Hosting ← workspace that actually runs
```

## Lesson ladder (videos)

| id | When | Plain sentence |
|----|------|----------------|
| `vaultix.lesson.keys-are-not-chat` | Before first secret | If it is in the prompt, it is already leaked. |
| `vaultix.lesson.one-project` | First Vaultix project | One box for every key this app will ever need. |
| `vaultix.lesson.inject-not-paste` | First DevForge / workspace run | The app asks Vaultix. You do not copy the value. |
| `vaultix.lesson.rotate` | After first deploy | Change the key here; the workspace picks it up. |
| `zuul.lesson.phone-first` | After they have a secret | Put the mesh on the phone. The app can stay private. |

Zuul lessons stay in `projects/zuul`. Vaultix lessons stay here. The panel plays them in one guided path.

## What we do not teach on this path

- Leftover vendor names, HashiCorp Vault, or “KMS”
- Pasting `OPENAI_API_KEY` into Lovable “so it works”
- Putting `.env` in git “just for now”
