# Progenitor Index

A signed, reviewed list of V Rising mods that [Progenitor](https://github.com/VRising-Modders/Progenitor) can install from.

The Index **lists** mods; it does not host their files. Each entry says where a mod version's package is (the author's GitHub release, or Thunderstore) and records the exact file's SHA-256 fingerprint. Progenitor downloads the package from there and installs it only if the fingerprint matches.

The Index is an **alternative** listing. The recommended home for a mod built on Progenitor is still [Thunderstore](https://thunderstore.io/c/v-rising/), with instructions telling players to install Progenitor from GitHub (see [For mod authors](#for-mod-authors)). The Index is for mods that can't or don't want to be on Thunderstore, and it lets Progenitor install everything from one signed, reviewed list.

## For players

You don't need to do anything with this repository. Open **Mods** on the title screen in V Rising, and Progenitor's installer shows the mods listed here next to the ones it finds on Thunderstore.

> **Status:** the Index is new. Progenitor reads it starting with the Progenitor release that adds Index support; earlier releases install from Thunderstore only.

New to Progenitor? Install it from its [GitHub page](https://github.com/VRising-Modders/Progenitor#install-players).

### How Progenitor uses the Index

1. Progenitor downloads the list (`index.json`) and its signature from GitHub Pages.
2. It checks the signature against the Index key built into Progenitor. A list with a bad signature is ignored, and Progenitor keeps the last good one. The signature uses the same format as Progenitor's signed mod manifests: ECDSA P-256 with SHA-256.
3. The installer shows each listed mod with its icon, description and README, read from the mod's own package when it was reviewed.
4. When you install a mod, Progenitor resolves its dependencies from the Index and Thunderstore, downloads each package, checks every fingerprint, and only then unpacks them.

### The fingerprint promise

Once a version is accepted, players can only ever install the exact file that was reviewed. Progenitor refuses any download whose fingerprint does not match the signed list. If an author deletes or replaces a release, that version can no longer be installed: nobody gets a different file. Players who already have it keep it.

### Imported entries

To start with useful content, many entries were imported from Thunderstore's V Rising listing: mods whose Thunderstore page links a GitHub repository. Imported entries say `"imported": true` and stay marked **unconfirmed** (`"confirmed": false`) until their author confirms the listing. Their files are the same packages Thunderstore serves, pinned by fingerprint. Where the author's GitHub release carries the identical zip, the entry points there; otherwise it points at Thunderstore. [`import-report.md`](import-report.md) lists what was imported and what was skipped and why.

Authors of imported mods: see [Confirming or removing an imported entry](CONTRIBUTING.md#confirming-or-removing-an-imported-entry).

## For mod authors

### Recommended: publish on Thunderstore

Publish your mod on Thunderstore as usual, and tell players to install Progenitor from GitHub. Progenitor itself is not on Thunderstore (Thunderstore does not host mod managers), so a Thunderstore manifest can't list it as a dependency; the README is where players learn they need it.

Copy this into your mod's README:

```markdown
## Requires Progenitor

This mod is built on [Progenitor](https://github.com/VRising-Modders/Progenitor), a V Rising
mod framework. Install Progenitor first by following its
[install guide](https://github.com/VRising-Modders/Progenitor#install-players), then install
this mod with your mod manager or from the **Mods** menu on the title screen.
```

### Listing here instead, or as well

Use the Index if your mod can't or doesn't want to be on Thunderstore, or to have Progenitor offer it from the reviewed list. You can do both: the same zip works for Thunderstore and for the Index.

1. Build your mod as a Thunderstore-layout package: `manifest.json`, a 256x256 `icon.png`, `README.md`, and your files under `BepInEx/`. Optionally add `CHANGELOG.md` and `progenitor.json`.
2. Publish a GitHub Release in your mod's repository with that zip attached.
3. Fork this repository and add one file, `entries/<YourGitHubAccount>/<ModName>/<version>.json`.
4. Open a pull request. The checks run automatically; a maintainer reviews it, usually within a week.

The full rules, the entry format and the review process are in [CONTRIBUTING.md](CONTRIBUTING.md).

## What is in this repository

| Path | What it is |
|---|---|
| `entries/` | One small JSON file per listed mod version |
| `meta/` | What the index shows for each version (manifest fields, README, changelog, icon, dependency fingerprints), read from the package when its entry was checked |
| `revoked.json` | Versions taken down, with a reason and severity |
| `thunderstore-lock.json` | Fingerprints of the Thunderstore packages that listed mods depend on |
| `schema/` | JSON Schemas for entry files and `progenitor.json` |
| `tools/` | Node.js 22 scripts: validate, build, sign, verify, key generation, Thunderstore import |
| `.github/workflows/` | Pull request checks, and the publish job that builds, signs and deploys to GitHub Pages |

Run the checks locally with `node tools/validate.mjs entries/<Owner>/<Name>/<version>.json`. No packages need installing beyond Node.js 22.

## License

The tooling and documentation here are under the [MIT License](LICENSE). Listed mods are not part of this repository and keep their own licenses.
