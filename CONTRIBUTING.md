# Contributing to the Progenitor Index

This guide covers how to list a mod version, what the checks look for, how review works and how takedowns work. Thunderstore remains the recommended home for mods built on Progenitor (see the [README](README.md#for-mod-authors)); the Index is an alternative listing.

**Response time:** maintainers review submissions within a week. A pull request that fails a hard check waits for you to fix it before review starts.

## Package rules

Mods use [Thunderstore's package layout](https://thunderstore.io/package/create/docs/), unchanged, so one zip works for both. Everything goes at the root of the zip.

| File | Required | Rule |
|---|---|---|
| `manifest.json` | Yes | See below |
| `icon.png` | Yes | PNG, exactly 256x256 pixels |
| `README.md` | Yes | The long description shown on the mod's page in Progenitor |
| `CHANGELOG.md` | No | Shown with updates |
| `progenitor.json` | No | Progenitor details; defaults apply when it is missing |
| Mod files | Yes | The usual `BepInEx/plugins/...` layout (and `BepInEx/config/...` when you ship defaults) |

### manifest.json

```json
{
  "name": "PopupTotals",
  "version_number": "1.2.0",
  "website_url": "https://github.com/ExampleAuthor/PopupTotals",
  "description": "Shows damage and healing totals above units.",
  "dependencies": [
    "BepInEx-BepInExPack_V_Rising-1.733.2"
  ]
}
```

- `name`: letters, digits and underscores only. It must match the entry's `<Name>` folder.
- `version_number`: `major.minor.patch`. It must match the entry's file name.
- `website_url`: your mod's GitHub repository.
- `description`: **250 characters or fewer**.
- `dependencies`: Thunderstore-style `Owner-Name-Version` strings. Each must be listed in the Index or on Thunderstore (see [Dependencies](#dependencies)).

### progenitor.json (optional)

Kept apart from `manifest.json` so the same zip still uploads to Thunderstore unchanged. Schema: [`schema/progenitor.schema.json`](schema/progenitor.schema.json).

```json
{
  "sides": "client",
  "progenitor": ">=2026.10.162"
}
```

| Field | Meaning | Default when missing |
|---|---|---|
| `sides` | Where the mod runs: `client`, `server` or `both` | Progenitor works it out from the package, as it does for Thunderstore mods |
| `progenitor` | The Progenitor version range the mod needs | Taken from a `*-Progenitor-<version>` dependency (as `>=<version>`), otherwise any version |

Other fields are allowed and ignored, so new ones can be added later.

### Contents

The package must not contain executables, scripts or installers: no `.exe`, `.bat`, `.cmd`, `.ps1`, `.msi`, `.vbs` or `.scr` files anywhere in the zip. Paths must stay inside the package (no absolute paths or `..`).

## Entry files

One file per mod version, at:

```
entries/<Owner>/<Name>/<version>.json
```

- `<Owner>` is the GitHub account that owns the mod's repository (for imported entries, the Thunderstore team).
- `<Name>` and `<version>` come from the package's `manifest.json`.

```json
{
  "source": "github-release",
  "repo": "https://github.com/ExampleAuthor/PopupTotals",
  "commit": "4f1c2d9e0b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d",
  "package": "https://github.com/ExampleAuthor/PopupTotals/releases/download/v1.2.0/ExampleAuthor-PopupTotals-1.2.0.zip",
  "sha256": "8a3f0c...e91c",
  "imported": false,
  "confirmed": true
}
```

| Field | Required | Meaning |
|---|---|---|
| `source` | Yes | `github-release` or `thunderstore`: where the package is downloaded from. Author submissions use `github-release`. |
| `repo` | Yes | `https://github.com/<owner>/<repo>`, nothing after the repository name |
| `commit` | Yes, except imports | The full 40-character commit the package was built from |
| `package` | Yes | For `github-release`: a release asset of `repo`, `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip`. For `thunderstore`: `https://thunderstore.io/package/download/<Owner>/<Name>/<version>/` |
| `sha256` | Yes | SHA-256 of the package file, lowercase hex |
| `imported` | Yes | `false` for your own submission |
| `confirmed` | Yes | `true` for your own submission; `false` on imported entries until the author confirms |

Schema: [`schema/entry.schema.json`](schema/entry.schema.json). Get the fingerprint with `sha256sum <file>.zip` (Linux, macOS, Git Bash) or `Get-FileHash <file>.zip` (PowerShell; lowercase the result).

`commit` and `sha256` are the lock: the exact source revision and the exact file. Moving a tag or re-uploading a release asset changes nothing for players; a replaced file simply stops installing. An update is a **new** entry file for the new version. Listed versions are not edited after review.

## Dependencies

Each `Owner-Name-Version` dependency must be found in one of two places:

1. **The Index**, checked first: an entry file for that exact version.
2. **Thunderstore**, checked next: that exact version on the V Rising community.

Thunderstore dependencies are pinned by fingerprint in [`thunderstore-lock.json`](thunderstore-lock.json), so Progenitor verifies every file it installs, not just the mod itself. If your mod needs a Thunderstore version that is not in the lock yet, run:

```
node tools/validate.mjs --update-lock entries/<Owner>/<Name>/<version>.json
```

and commit the updated lock with your entry. If a dependency is in neither place, add it to the Index first.

## Checks

The `Check entries` workflow runs on every pull request, using the tools from `main` (changes to `tools/` in a pull request do not affect its own checks). It posts a summary of the results. Run the same checks locally with Node.js 22:

```
node tools/validate.mjs entries/<Owner>/<Name>/<version>.json
```

Hard checks block the pull request:

| Check | What it does |
|---|---|
| Shape | The entry is valid JSON matching the schema, in a correctly named folder |
| Fingerprint | Downloads the package and confirms its SHA-256 |
| Package format | `manifest.json` valid, description 250 characters or fewer, `icon.png` 256x256, `README.md` present, `progenitor.json` valid if present |
| Folder names | `<Name>` and `<version>` match the manifest |
| Ownership | For author submissions, `<Owner>` is the GitHub account that owns `repo` |
| Release | For `github-release`, the package is a release asset of `repo` |
| Dependencies | Every dependency is in the Index or on Thunderstore, and each Thunderstore one matches its fingerprint in `thunderstore-lock.json` |
| Contents | No executables, scripts or installers in the package |

The bot also notes things for the reviewer without blocking: an edit to an already listed version (only confirmations of imported entries are accepted), a `website_url` that does not match `repo`, deprecated dependencies, and more than one entry in one pull request.

## Review tiers

After the checks pass, a maintainer reviews the submission. How much depends on the author's history:

| Tier | Who | Review |
|---|---|---|
| New | First submission from an author | Full: skim the source at the pinned commit, every risky call explained, a live test when the mod touches saves, the network or other players |
| Known | Three or more approved versions, no problems | The changes since the last approved version |
| Trusted | Authors the maintainers choose, with build attestations | Quick merge when nothing new needs explaining; spot checks |

An author drops back to New after any takedown. Things that need a good explanation in your pull request: network access (which hosts and why), starting processes, loading code at runtime, native calls, and writing outside the game folder. Obfuscated or packed assemblies can't be reviewed and are usually declined.

## Confirming or removing an imported entry

Imported entries came from Thunderstore and are marked `"confirmed": false`.

- **To confirm** your imported mod: open a pull request that sets `"confirmed": true` in its entry, from the GitHub account that owns the mod's repository (or comment on an issue from that account). From then on, submit new versions as normal entries.
- **To remove** it: open an issue or a pull request removing the entry, from that account. Removal requests from the mod's author are always granted.

## Takedowns

The Index hosts no files, so complaints about a file itself belong to the author's repository and GitHub. The list is the Index's endorsement, and maintainers remove that endorsement when an approved version turns out bad: malware, a mod listed by someone who doesn't own it, or a serious bug.

A takedown is a pull request that adds the version to [`revoked.json`](revoked.json):

```json
[
  {
    "owner": "ExampleAuthor",
    "name": "PopupTotals",
    "version": "1.2.0",
    "reason": "Sends player data to an undisclosed server.",
    "severity": "disable",
    "date": "2026-10-20"
  }
]
```

`version` may be `"*"` for every version.

| Severity | What Progenitor does |
|---|---|
| `hidden` | No longer offered for new installs; existing installs keep working |
| `warning` | Installed copies show a notice with the reason |
| `disable` | Installed copies stop loading at the next start, with a notice explaining why |

A version whose author deleted its release needs no takedown; it simply stops installing. To report a problem with a listed mod, open an issue with the entry path and what you found.

## Pull request checklist

The [pull request template](.github/PULL_REQUEST_TEMPLATE.md) lists what to include. In short: one entry per pull request, the release is published, the checks pass locally, and anything a reviewer would ask about (network use, processes, native code) is explained up front.
