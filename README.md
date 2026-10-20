# Progenitor Index

The home of mods built on [Progenitor](https://github.com/VRising-Modders/Progenitor): a signed, reviewed list of V Rising mods that Progenitor installs from its **Mods** menu.

The Index **lists** mods; it does not host their files. Each entry says where a mod version's package is (the author's GitHub release, or Thunderstore) and records the exact file's SHA-256 fingerprint. Progenitor downloads the package from there and installs it only if the fingerprint matches.

Authors of mods built on Progenitor publish here: a GitHub release with the package, and a pull request that adds its entry (see [For mod authors](#for-mod-authors)). Thunderstore does not host Progenitor or the mods built on it; it remains the place for BepInEx and for mods that don't use Progenitor. The Index also lists many of those Thunderstore mods ([imported entries](#imported-entries)), so Progenitor can install everything from one signed, reviewed list.

## For players

You don't need to do anything with this repository. Open **Mods** on the title screen in V Rising, and Progenitor's installer shows the mods listed here next to the ones it finds on Thunderstore.

> **Status:** the Index is new. Progenitor reads it starting with the Progenitor release that adds Index support; earlier releases install from Thunderstore only.

New to Progenitor? Install it from its [GitHub page](https://github.com/VRising-Modders/Progenitor#install-players).

### How Progenitor uses the Index

1. Progenitor downloads the list (`index.json`) and its signature from GitHub Pages.
2. It checks the signature against the Index key built into Progenitor. A list with a bad signature is ignored, and Progenitor keeps the last good one. The signature uses the same format as Progenitor's signed mod manifests: ECDSA P-256 with SHA-256.

   The Index public key (base64 SPKI DER, fingerprint `eee964f144cb8d67`) is also in [`index-signing-key.pub.txt`](index-signing-key.pub.txt). Check a downloaded list yourself with `node tools/verify.mjs --pub index-signing-key.pub.txt --file index.json`.

3. The installer shows each listed mod with its icon, description and README, read from the mod's own package when it was reviewed.
4. When you install a mod, Progenitor resolves its dependencies from the Index and Thunderstore, downloads each package, checks every fingerprint, and only then unpacks them.

### The fingerprint promise

Once a version is accepted, players can only ever install the exact file that was reviewed. Progenitor refuses any download whose fingerprint does not match the signed list. If an author deletes or replaces a release, that version can no longer be installed: nobody gets a different file. Players who already have it keep it.

### Imported entries

To start with useful content, many entries were imported from Thunderstore's V Rising listing: mods whose Thunderstore page links a GitHub repository. Imported entries say `"imported": true` and stay marked **unconfirmed** (`"confirmed": false`) until their author confirms the listing. Their files are the same packages Thunderstore serves, pinned by fingerprint. Where the author's GitHub release carries the identical zip, the entry points there; otherwise it points at Thunderstore. [`import-report.md`](import-report.md) lists what was imported and what was skipped and why.

Authors of imported mods: see [Confirming or removing an imported entry](CONTRIBUTING.md#confirming-or-removing-an-imported-entry).

## For mod authors

A mod built on Progenitor is published here, not on Thunderstore. Players install it from **Install Mods** in Progenitor's Mods menu, and Progenitor hot loads it when the mod supports that.

1. Build the package in Thunderstore's package format: `manifest.json`, a 256x256 `icon.png`, `README.md`, the plugin DLL and its `progenitor.json`. Progenitor's [publishing guide](https://github.com/VRising-Modders/Progenitor/blob/main/docs/publishing.md) covers the package, the README's "Requires Progenitor" block and its checker.
2. Publish a GitHub release in your mod's repository with that zip attached.
3. Fork this repository, add one file, `entries/<YourGitHubAccount>/<ModName>/<version>.json`, and generate its meta with `node tools/validate.mjs --update-lock --write-meta entries/<YourGitHubAccount>/<ModName>/<version>.json`.
4. Open a pull request. The checks run automatically; a maintainer reviews it, usually within a week.

Step by step: [Publishing a mod version](CONTRIBUTING.md#publishing-a-mod-version). The full rules, the entry format and the review process are in [CONTRIBUTING.md](CONTRIBUTING.md).

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
