<!-- One mod version per pull request. See CONTRIBUTING.md for the rules. -->

## Mod

- Entry: `entries/<Owner>/<Name>/<version>.json`
- Repository:
- Release:
- New mod, or update from version:

## What it does

<!-- A few sentences. For an update, what changed. -->

## Things a reviewer will ask about

<!-- Say "none" if a line does not apply. -->

- Network access (which hosts, and why):
- Starts processes, loads code at runtime, or makes native calls:
- Writes files outside the game folder:
- Touches saves, or affects other players on a server:

## Checklist

- [ ] The package follows the package format: `manifest.json`, 256x256 `icon.png`, `README.md`, description of 250 characters or fewer.
- [ ] The release is published and the entry's `package` URL is its zip asset; `sha256` and `commit` are filled in.
- [ ] `meta/<Owner>/<Name>/<version>/` is generated with `node tools/validate.mjs --write-meta <entry>` and committed.
- [ ] `node tools/validate.mjs <entry>` passes locally.
- [ ] New Thunderstore dependencies are added to `thunderstore-lock.json` (`--update-lock`).
- [ ] The repository has a license file.
- [ ] I own this mod's repository, or I am confirming or removing my own imported entry.
